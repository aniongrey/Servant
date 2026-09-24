import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASR_ASSET_FILES, RUNTIME_BASE_PATH } from './sherpaSpeechConfig.ts';

const repoRoot = process.cwd();
const read = (relative: string): string => readFileSync(path.resolve(repoRoot, relative), 'utf8');

/**
 * The engine ships with the app; the model it loads does not. Everything below
 * that points at this directory is about the *runtime*, and the model files are
 * expected to be absent from it.
 */
const RUNTIME_DIR = 'public/engines/sensevoice';
const WORKER_SOURCE = read(`${RUNTIME_DIR}/offline-worker.js`);
const RECOGNITION_SOURCE = read('src/ai/stt/SherpaSpeechRecognition.ts');
const TAURI_CONFIG = read('src-tauri/tauri.conf.json');

/**
 * The page and the worker agree on a handshake no compiler checks: `init.assets`
 * carries the URLs, and the worker has to read every one of them back. An earlier
 * revision built and sent those URLs while the worker kept fetching sibling files,
 * so "the user downloaded a model" silently still meant "the bundled copy was
 * used" — the download appeared to work and changed nothing.
 */
describe('SenseVoice asset handshake', () => {
  it('has the page send an `assets` payload built from the shared file table', () => {
    expect(RECOGNITION_SOURCE).toContain('assets: createSenseVoiceAssetUrls()');
  });

  it('has the worker read that payload instead of assuming sibling files', () => {
    expect(WORKER_SOURCE).toContain('data.assets');
    expect(WORKER_SOURCE).toContain('resolveAssetUrls');
  });

  it('consumes every asset key the page provides', () => {
    for (const key of Object.keys(ASR_ASSET_FILES)) {
      expect(WORKER_SOURCE).toContain(`'${key}'`);
    }
  });

  it('keeps a sibling-file fallback so an unprepared model degrades instead of failing', () => {
    expect(WORKER_SOURCE).toContain('fetchAssetWithFallback');
    for (const file of Object.values(ASR_ASSET_FILES)) {
      expect(WORKER_SOURCE).toContain(`'${file}'`);
    }
  });
});

interface FakeResponse {
  ok: boolean;
  status: number;
}

interface WorkerAssetScope {
  resolveAssetUrls(assets: unknown): Record<string, string>;
  fetchAssetWithFallback(
    url: string,
    fallbackUrl?: string
  ): Promise<{ url: string; response: FakeResponse }>;
}

/**
 * The worker is a classic script, not a module, so it cannot be imported; running
 * it in a stub scope is the only way to exercise the resolution order without a
 * browser. Only the two helpers are returned — everything else in the file needs
 * the WASM runtime.
 */
function loadWorkerScope(fetchImpl: (url: string) => Promise<FakeResponse>): WorkerAssetScope {
  const self: Record<string, unknown> = {};
  const factory = new Function(
    'self',
    'importScripts',
    'Module',
    'fetch',
    'console',
    'performance',
    'close',
    `${WORKER_SOURCE}\nreturn { resolveAssetUrls, fetchAssetWithFallback };`
  );
  return factory(
    self,
    () => undefined,
    undefined,
    fetchImpl,
    { info: () => undefined, warn: () => undefined, error: () => undefined },
    { now: () => 0 },
    () => undefined
  ) as WorkerAssetScope;
}

const statusResponder =
  (byUrl: Record<string, number>) =>
  async (url: string): Promise<FakeResponse> => {
    const status = byUrl[url] ?? 404;
    return { ok: status >= 200 && status < 300, status };
  };

describe('SenseVoice asset URL resolution', () => {
  it('falls back to sibling files when the page sends nothing', () => {
    const scope = loadWorkerScope(statusResponder({}));
    expect(scope.resolveAssetUrls(undefined)).toEqual({
      model: ASR_ASSET_FILES.model,
      tokens: ASR_ASSET_FILES.tokens,
      vadV5: ASR_ASSET_FILES.vadV5,
      vadLegacy: ASR_ASSET_FILES.vadLegacy
    });
  });

  it('resolves each key independently, so one blank entry does not discard the rest', () => {
    const scope = loadWorkerScope(statusResponder({}));
    const resolved = scope.resolveAssetUrls({
      model: '/api/provisioning/assets/sherpa-asr-model/model.int8.onnx',
      tokens: '',
      vadV5: null,
      vadLegacy: 7
    });
    expect(resolved.model).toBe('/api/provisioning/assets/sherpa-asr-model/model.int8.onnx');
    expect(resolved.tokens).toBe(ASR_ASSET_FILES.tokens);
    expect(resolved.vadV5).toBe(ASR_ASSET_FILES.vadV5);
    expect(resolved.vadLegacy).toBe(ASR_ASSET_FILES.vadLegacy);
  });
});

describe('SenseVoice asset loading order', () => {
  it('uses the page-provided URL when the backend can serve it', async () => {
    const served = '/api/provisioning/assets/sherpa-asr-model/model.int8.onnx';
    const scope = loadWorkerScope(statusResponder({ [served]: 200 }));
    const { url } = await scope.fetchAssetWithFallback(served, ASR_ASSET_FILES.model);
    expect(url).toBe(served);
  });

  it('degrades to the sibling file when nothing has been downloaded yet', async () => {
    const missing = '/api/provisioning/assets/sherpa-asr-model/model.int8.onnx';
    const scope = loadWorkerScope(statusResponder({ [ASR_ASSET_FILES.model]: 200 }));
    const { url } = await scope.fetchAssetWithFallback(missing, ASR_ASSET_FILES.model);
    expect(url).toBe(ASR_ASSET_FILES.model);
  });

  it('reports every attempted location when both are missing', async () => {
    const missing = '/api/provisioning/assets/sherpa-asr-model/model.int8.onnx';
    const scope = loadWorkerScope(statusResponder({}));
    await expect(scope.fetchAssetWithFallback(missing, ASR_ASSET_FILES.model)).rejects.toThrow(
      new RegExp(`未找到 ${ASR_ASSET_FILES.model}`)
    );
    await expect(scope.fetchAssetWithFallback(missing, ASR_ASSET_FILES.model)).rejects.toThrow(
      /初始化面板/
    );
  });

  it('does not fetch the same location twice when there is no fallback', async () => {
    const seen: string[] = [];
    const scope = loadWorkerScope(async (url: string) => {
      seen.push(url);
      return { ok: false, status: 404 };
    });
    await expect(scope.fetchAssetWithFallback('model.int8.onnx')).rejects.toThrow();
    expect(seen).toEqual(['model.int8.onnx']);
  });
});

/**
 * The packaged app resolves the STT mirror against `resource_dir()`, which does
 * not carry `public/` — the frontend is compiled into the executable. Anything
 * the mirror has to supply therefore needs an explicit `bundle.resources` entry,
 * or `/api/provisioning/assets/...` 404s only in the installer.
 */
describe('packaged STT mirror', () => {
  const bundledResources = (JSON.parse(TAURI_CONFIG) as {
    bundle?: { resources?: Record<string, string> };
  }).bundle?.resources;

  it.each([ASR_ASSET_FILES.vadV5, ASR_ASSET_FILES.vadLegacy])(
    'ships %s, which no model repository provides',
    (file) => {
      const expectedDestination = `${RUNTIME_DIR}/${file}`;
      expect(bundledResources?.[`../${expectedDestination}`]).toBe(expectedDestination);
    }
  );
});

/**
 * The installer used to carry the model twice over: once as a repository
 * checkout, and again inside the 229MB `.data` preload package the glue wants.
 * Both are gone, and these assertions keep them from creeping back — a bundled
 * model makes the download pointless and the installer huge, which is exactly
 * what the setup panel exists to avoid.
 */
describe('bundled SenseVoice runtime stays model-free', () => {
  it.each([ASR_ASSET_FILES.model, ASR_ASSET_FILES.tokens])('does not ship %s', (file) => {
    expect(existsSync(path.resolve(repoRoot, RUNTIME_DIR, file))).toBe(false);
  });

  it('does not ship the preload package', () => {
    expect(
      existsSync(path.resolve(repoRoot, RUNTIME_DIR, 'sherpa-onnx-wasm-main-vad-asr.data'))
    ).toBe(false);
  });

  it('skips the preload package through the emscripten hook', () => {
    // The glue waits on a `datafile_...` run dependency that only the package
    // resolves, so an absent `.data` without this hook would hang the runtime
    // instead of failing it — the worst possible symptom to debug.
    expect(WORKER_SOURCE).toMatch(/getPreloadedPackage\(\)\s*\{\s*return new ArrayBuffer\(0\);/);
  });

  it('keeps the WASM binary the worker imports', () => {
    expect(
      existsSync(path.resolve(repoRoot, RUNTIME_DIR, 'sherpa-onnx-wasm-main-vad-asr.wasm'))
    ).toBe(true);
  });

  it('serves the worker from a directory that exists', () => {
    const served = RUNTIME_BASE_PATH.replace(/^\//, '');
    expect(existsSync(path.resolve(repoRoot, 'public', served, 'offline-worker.js'))).toBe(true);
  });
});
