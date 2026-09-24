import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  downloadModelRepo,
  listModelRepoFiles,
  parseHuggingFaceFileList,
  parseModelScopeFileList,
  readModelRepoMarker,
  repoPathMatches,
  REPO_MARKER_FILE,
  type ModelSite
} from './modelRepository.ts';
import { DEFAULT_MODEL_SITE_ORDER, normalizeModelSiteOrder } from '../../provisioning/provisioningTypes.ts';

const FILE_BODIES: Record<string, Buffer> = {
  'README.md': Buffer.from('# readme'),
  '1_Pooling/config.json': Buffer.from('{"pooling":true}'),
  'config.json': Buffer.from('{"hidden_size":1024}'),
  'tokens/weights.bin': Buffer.alloc(4096, 7)
};

/**
 * Shaped after the real `https://www.modelscope.cn/api/v1/models/<repo>/repo/files`
 * response: blobs and trees mixed, sizes on every entry. Sizes are generated from
 * the served bodies so the skip-existing path can be exercised for real.
 */
const MODELSCOPE_LIST_PAYLOAD = {
  Code: 200,
  Data: {
    Files: [
      { Path: '1_Pooling', Size: 0, Type: 'tree' },
      ...Object.entries(FILE_BODIES).map(([path, body]) => ({
        Path: path,
        Size: body.length,
        Type: 'blob'
      }))
    ]
  },
  Success: true
};

/**
 * Shaped after the real `pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue`
 * repository: the int8 model we load sits beside a 894.2 MiB float32 model we
 * never load, which is exactly why the manifest carries an allow-list.
 */
const SENSEVOICE_BODIES: Record<string, Buffer> = {
  'model.int8.onnx': Buffer.alloc(1024, 3),
  'tokens.txt': Buffer.from('a b c')
};

const SENSEVOICE_LIST_PAYLOAD = {
  Code: 200,
  Data: {
    Files: [
      { Path: 'model.onnx', Size: 937_617_178, Type: 'blob' },
      { Path: 'README.md', Size: 1581, Type: 'blob' },
      ...Object.entries(SENSEVOICE_BODIES).map(([path, body]) => ({
        Path: path,
        Size: body.length,
        Type: 'blob'
      }))
    ]
  },
  Success: true
};

let server: Server;
let baseUrl: string;
let workDir: string;
beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'shiro-repo-'));
  server = createServer((request, response) => {
    response.setHeader('Connection', 'close');
    if (request.url === '/api/list') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(MODELSCOPE_LIST_PAYLOAD));
      return;
    }
    if (request.url === '/api/broken') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<html>temporarily unavailable</html>');
      return;
    }
    if (request.url === '/api/list-sensevoice') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(SENSEVOICE_LIST_PAYLOAD));
      return;
    }
    if (request.url === '/api/empty') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ Code: 200, Data: { Files: [] }, Success: true }));
      return;
    }
    if (request.url === '/api/gone') {
      response.statusCode = 404;
      response.end('not found');
      return;
    }
    if (request.url?.startsWith('/api/raw/')) {
      const path = decodeURIComponent(request.url.slice('/api/raw/'.length));
      const body = FILE_BODIES[path] ?? SENSEVOICE_BODIES[path];
      if (!body) {
        response.statusCode = 404;
        response.end('no such file');
        return;
      }
      response.setHeader('Content-Length', String(body.length));
      response.end(body);
      return;
    }
    response.statusCode = 404;
    response.end('nope');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await rm(workDir, { recursive: true, force: true });
});

/** A site descriptor pointed at the in-process fake, using the real parser. */
function localSite(listPath = '/api/list'): ModelSite {
  return {
    id: 'modelscope',
    label: '测试站点',
    defaultRevision: 'master',
    listUrl: () => `${baseUrl}${listPath}`,
    fileUrl: (_repo, _revision, path) => `${baseUrl}/api/raw/${encodeURIComponent(path)}`,
    parseList: parseModelScopeFileList
  };
}

describe('parseModelScopeFileList', () => {
  it('keeps blobs with their sizes and drops directory entries', () => {
    const files = parseModelScopeFileList(MODELSCOPE_LIST_PAYLOAD);
    expect(files.map((file) => file.path)).toEqual([
      'README.md',
      '1_Pooling/config.json',
      'config.json',
      'tokens/weights.bin'
    ]);
    expect(files.find((file) => file.path === 'tokens/weights.bin')?.sizeBytes).toBe(4096);
  });

  it('returns nothing for an unexpected payload instead of throwing', () => {
    expect(parseModelScopeFileList('<html>error</html>')).toEqual([]);
    expect(parseModelScopeFileList({ Data: {} })).toEqual([]);
  });
});

describe('parseHuggingFaceFileList', () => {
  it('reads LFS sizes from the nested lfs object', () => {
    const files = parseHuggingFaceFileList([
      { type: 'directory', path: '1_Pooling' },
      { type: 'file', path: 'config.json', size: 727 },
      { type: 'file', path: 'model.safetensors', lfs: { size: 1191586416 } }
    ]);
    expect(files).toEqual([
      { path: 'config.json', sizeBytes: 727 },
      { path: 'model.safetensors', sizeBytes: 1191586416 }
    ]);
  });
});

describe('normalizeModelSiteOrder', () => {
  it('defaults to ModelScope first and still lists every fallback', () => {
    expect(normalizeModelSiteOrder(undefined)).toEqual([...DEFAULT_MODEL_SITE_ORDER]);
    expect(normalizeModelSiteOrder(undefined)[0]).toBe('modelscope');
  });

  it('honours a stored preference and appends the remaining sites', () => {
    expect(normalizeModelSiteOrder(['huggingface'])).toEqual([
      'huggingface',
      'modelscope',
      'hf-mirror'
    ]);
  });

  it('drops unknown ids and duplicates', () => {
    expect(normalizeModelSiteOrder(['hf-mirror', 'hf-mirror', 'bogus', 7])).toEqual([
      'hf-mirror',
      'modelscope',
      'huggingface'
    ]);
  });
});

describe('listModelRepoFiles', () => {
  const ref = { repo: 'Qwen/Qwen3-Embedding-0.6B' };

  it('names the site when it answers with a non-JSON error page', async () => {
    await expect(
      listModelRepoFiles(localSite('/api/broken'), ref, { fetchImpl: globalThis.fetch })
    ).rejects.toThrow(/测试站点.*无法解析/);
  });

  it('rejects an empty file list instead of pretending the repo has no files', async () => {
    await expect(
      listModelRepoFiles(localSite('/api/empty'), ref, { fetchImpl: globalThis.fetch })
    ).rejects.toThrow(/未返回任何文件/);
  });

  it('reports the HTTP status when the list endpoint fails', async () => {
    await expect(
      listModelRepoFiles(localSite('/api/gone'), ref, { fetchImpl: globalThis.fetch })
    ).rejects.toThrow(/HTTP 404/);
  });
});

describe('downloadModelRepo', () => {
  it('pulls every file of the repository and records a marker', async () => {
    const directory = join(workDir, 'repo-a');
    const progress: Array<[number, number]> = [];
    const seen: string[] = [];

    const result = await downloadModelRepo(localSite(), { repo: 'Qwen/Qwen3-Embedding-0.6B' }, directory, {
      fetchImpl: globalThis.fetch,
      onFileDone: (file) => seen.push(file.path),
      onProgress: (received, total) => progress.push([received, total])
    });

    expect(result.files).toHaveLength(4);
    expect(result.downloaded).toBe(4);
    expect(result.bytes).toBe(Object.values(FILE_BODIES).reduce((sum, body) => sum + body.length, 0));
    expect(seen).toEqual(['README.md', '1_Pooling/config.json', 'config.json', 'tokens/weights.bin']);

    // Nested repository paths must be recreated on disk.
    expect(await readFile(join(directory, '1_Pooling', 'config.json'), 'utf8')).toBe('{"pooling":true}');
    expect(await readFile(join(directory, 'tokens', 'weights.bin'))).toEqual(FILE_BODIES['tokens/weights.bin']);

    // Aggregate progress ends on the repository total.
    const last = progress[progress.length - 1];
    expect(last[1]).toBe(result.bytes);
    expect(last[0]).toBe(result.bytes);

    const marker = await readModelRepoMarker(directory);
    expect(marker?.repo).toBe('Qwen/Qwen3-Embedding-0.6B');
    expect(marker?.site).toBe('modelscope');
    expect(marker?.files).toHaveLength(4);
    expect(await readFile(join(directory, REPO_MARKER_FILE), 'utf8')).toContain('Qwen3-Embedding');
  });

  it('skips files that are already complete on a second run', async () => {
    const directory = join(workDir, 'repo-b');
    const ref = { repo: 'Qwen/Qwen3-Embedding-0.6B' };

    const first = await downloadModelRepo(localSite(), ref, directory, { fetchImpl: globalThis.fetch });
    expect(first.downloaded).toBe(4);

    const second = await downloadModelRepo(localSite(), ref, directory, { fetchImpl: globalThis.fetch });
    expect(second.downloaded).toBe(0);
    expect(second.skipped).toBe(4);
    expect(second.bytes).toBe(first.bytes);
  });

  it('surfaces a site failure so the caller can fall back to the next site', async () => {
    const directory = join(workDir, 'repo-c');
    await expect(
      downloadModelRepo(localSite('/api/broken'), { repo: 'Qwen/Qwen3-Embedding-0.6B' }, directory, {
        fetchImpl: globalThis.fetch
      })
    ).rejects.toThrow(/测试站点/);
    // Nothing may be left behind that looks installable.
    expect(await readModelRepoMarker(directory)).toBeNull();

    // The fallback site then completes the same repository.
    const fallback = await downloadModelRepo(localSite(), { repo: 'Qwen/Qwen3-Embedding-0.6B' }, directory, {
      fetchImpl: globalThis.fetch
    });
    expect(fallback.site).toBe('modelscope');
    expect(fallback.downloaded).toBe(4);
    expect((await readModelRepoMarker(directory))?.files).toHaveLength(4);
  });
});

describe('repoPathMatches', () => {
  it('matches exact repository paths', () => {
    expect(repoPathMatches('model.int8.onnx', 'model.int8.onnx')).toBe(true);
    expect(repoPathMatches('model.onnx', 'model.int8.onnx')).toBe(false);
  });

  it('treats * as "within one segment" and ** as "any depth"', () => {
    expect(repoPathMatches('config.json', '*.json')).toBe(true);
    expect(repoPathMatches('nested/config.json', '*.json')).toBe(false);
    expect(repoPathMatches('nested/config.json', '**/*.json')).toBe(true);
    expect(repoPathMatches('config.json', '**/*.json')).toBe(true);
    expect(repoPathMatches('a/b/c.bin', 'a/**/*.bin')).toBe(true);
  });

  it('does not treat dots or plus signs in a pattern as regex syntax', () => {
    expect(repoPathMatches('aXb', 'a.b')).toBe(false);
    expect(repoPathMatches('a+b', 'a+b')).toBe(true);
  });
});

describe('repository allow-lists', () => {
  const ref = {
    repo: 'pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue',
    include: ['model.int8.onnx', 'tokens.txt']
  };

  it('keeps the 894.2 MiB float model off the wire', async () => {
    const directory = join(workDir, 'sensevoice');
    const fetched: string[] = [];
    const site: ModelSite = {
      ...localSite('/api/list-sensevoice'),
      fileUrl: (_repo, _revision, path) => {
        fetched.push(path);
        return `${baseUrl}/api/raw/${encodeURIComponent(path)}`;
      }
    };

    const result = await downloadModelRepo(site, ref, directory, { fetchImpl: globalThis.fetch });

    expect(result.files.map((file) => file.path)).toEqual(['model.int8.onnx', 'tokens.txt']);
    expect(result.downloaded).toBe(2);
    // Filtering must happen before anything is requested, not after.
    expect(fetched).not.toContain('model.onnx');
    expect(result.bytes).toBe(SENSEVOICE_BODIES['model.int8.onnx'].length + SENSEVOICE_BODIES['tokens.txt'].length);

    const marker = await readModelRepoMarker(directory);
    expect(marker?.files.map((file) => file.path)).toEqual(['model.int8.onnx', 'tokens.txt']);
    await expect(readFile(join(directory, 'model.onnx'))).rejects.toThrow();
  });

  it('reports a misconfigured allow-list as a manifest error, not a site failure', async () => {
    await expect(
      downloadModelRepo(
        localSite('/api/list-sensevoice'),
        { repo: 'x/y', include: ['does-not-exist.bin'] },
        join(workDir, 'sensevoice-bad'),
        { fetchImpl: globalThis.fetch }
      )
    ).rejects.toThrow(/include/);
  });
});
