import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiModule, MiddlewareHost } from '../httpMiddleware.ts';
import { apiPathOf, isRecord, readRequestBody, sendJson } from '../httpMiddleware.ts';
import type { ProjectPaths } from '../projectPaths.ts';
import {
  DEFAULT_GPT_SOVITS_SETTINGS,
  GPT_SOVITS_API_PREFIX,
  GPT_SOVITS_DATA_DIRECTORY,
  GPT_SOVITS_EMOTIONS,
  GPT_SOVITS_TTS_HEADERS,
  type GptSovitsEmotion,
  type GptSovitsProfile,
  type GptSovitsState,
  type GptSovitsTtsRequest
} from '../../gptSovitsContract.ts';
import { GptSovitsClient, GsError } from './gptSovitsClient.ts';
import { scanGptSovitsModels } from './gptSovitsScanner.ts';
import { createGptSovitsStore, GptSovitsStoreError, type GptSovitsStore } from './gptSovitsStore.ts';

/**
 * Backend surface of the GPT-SoVITS integration.
 *
 * Everything the voice settings and the studio page need lives behind one
 * prefix, so the feature is reachable from the Vite dev server, `vite preview`
 * and the packaged sidecar without a second code path or a second process —
 * the prototype this was ported from ran its own service on :3799, which is
 * exactly the kind of "works next to the app" process the sidecar exists to
 * avoid.
 *
 * GPT-SoVITS itself is never modified; only `api_v2.py` on 9880 is called.
 */

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const ALLOWED_AUDIO_EXTENSIONS = ['.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac', '.wma'];

export function gptSovitsApi(paths: ProjectPaths): ApiModule {
  const dataDir = path.resolve(paths.data, GPT_SOVITS_DATA_DIRECTORY);
  const store: GptSovitsStore = createGptSovitsStore({
    dataDir,
    defaultRoot: process.env.GPT_SOVITS_ROOT?.trim() || ''
  });
  const client = new GptSovitsClient();

  const configure = (server: MiddlewareHost) => {
    server.middlewares.use((request, response, next) => {
      void handle(request, response, next, store, client).catch((cause: unknown) => {
        if (response.headersSent) {
          response.end();
          return;
        }
        const status =
          cause instanceof GsError || cause instanceof GptSovitsStoreError
            ? cause.status
            : (cause as { status?: number } | null)?.status ?? 500;
        const detail =
          cause instanceof GsError ? cause.detail : (cause as { detail?: string } | null)?.detail ?? '';
        sendJson(response, status, {
          error: cause instanceof Error ? cause.message : '服务器内部错误',
          ...(detail ? { detail } : {})
        });
      });
    });
  };

  return { name: 'gpt-sovits', configureServer: configure, configurePreviewServer: configure };
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
  store: GptSovitsStore,
  client: GptSovitsClient
): Promise<void> {
  const route = apiPathOf(request);
  if (!route.startsWith(`${GPT_SOVITS_API_PREFIX}/`)) {
    next();
    return;
  }

  const subPath = route.slice(GPT_SOVITS_API_PREFIX.length);
  const method = request.method ?? 'GET';
  const query = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams;

  await store.ready();

  if (subPath === '/state' && method === 'GET') {
    const state: GptSovitsState = {
      root: store.getRoot(),
      profiles: store.listProfiles(),
      apiUrl: client.apiUrl,
      loaded: store.getLoaded()
    };
    sendJson(response, 200, state);
    return;
  }

  if (subPath === '/health' && method === 'GET') {
    sendJson(response, 200, await client.health());
    return;
  }

  if (subPath === '/root' && method === 'POST') {
    const body = await readJsonBody(request);
    const root = String(body.root ?? '').trim();
    if (!root) throw httpError('安装目录不能为空', 400);
    const absolute = path.resolve(root);
    if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
      // A bad path must not wipe the last known-good install root.
      throw httpError('目录不存在或不是文件夹，未修改已保存的安装目录', 400, absolute);
    }
    sendJson(response, 200, { ok: true, root: await store.setRoot(absolute) });
    return;
  }

  if (subPath === '/models' && method === 'GET') {
    const root = store.getRoot();
    if (!root) {
      sendJson(response, 200, {
        gpt: [],
        sovits: [],
        root: '',
        missing: [],
        error: '尚未设置安装目录'
      });
      return;
    }
    sendJson(response, 200, scanGptSovitsModels(root));
    return;
  }

  if (subPath === '/models/apply' && method === 'POST') {
    const body = await readJsonBody(request);
    const loaded = await withLock(() =>
      ensureModels(store, client, {
        models: { gpt: String(body.gpt ?? ''), sovits: String(body.sovits ?? '') }
      } as GptSovitsProfile)
    );
    sendJson(response, 200, { ok: true, loaded });
    return;
  }

  if (subPath === '/references/upload' && method === 'POST') {
    const name = safeFileName(readFilenameHeader(request));
    const bytes = await readRequestBody(request, MAX_UPLOAD_BYTES + 1);
    if (bytes.length > MAX_UPLOAD_BYTES) throw httpError('音频文件超过 25MB 上限', 413);
    if (bytes.length === 0) throw httpError('上传内容为空', 400);
    await mkdir(store.referencesDir, { recursive: true });
    const absolute = path.join(store.referencesDir, name);
    await writeFile(absolute, bytes);
    sendJson(response, 200, { ok: true, path: absolute, name });
    return;
  }

  if (subPath === '/references/audio' && method === 'GET') {
    const audioPath = query.get('path') ?? '';
    if (!isAllowedAudioPath(audioPath, store)) {
      throw httpError('只允许读取安装目录或 Servant 上传目录内的音频', 403, audioPath);
    }
    const absolute = path.resolve(audioPath);
    if (!existsSync(absolute)) throw httpError('音频文件不存在', 404, absolute);
    const status = statSync(absolute);
    response.statusCode = 200;
    response.setHeader('Content-Type', audioContentType(absolute));
    response.setHeader('Content-Length', status.size);
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Cache-Control', 'no-store');
    createReadStream(absolute).pipe(response);
    return;
  }

  if (subPath === '/profiles/save' && method === 'POST') {
    const body = await readJsonBody(request);
    const profile = await store.upsertProfile(body.profile ?? body);
    sendJson(response, 200, { ok: true, profile });
    return;
  }

  if (subPath === '/profiles/import' && method === 'POST') {
    const body = await readJsonBody(request);
    const profile = await store.importProfile(body.profile ?? body);
    sendJson(response, 200, { ok: true, profile });
    return;
  }

  const exportMatch = /^\/profiles\/([^/]+)\/export$/.exec(subPath);
  if (exportMatch && method === 'GET') {
    const profile = store.getProfile(decodeURIComponent(exportMatch[1]));
    if (!profile) throw httpError('角色不存在', 404);
    const body = JSON.stringify(profile, null, 2);
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Content-Length', Buffer.byteLength(body));
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(`${profile.name}.json`)}`
    );
    response.end(body);
    return;
  }

  const profileMatch = /^\/profiles\/([^/]+)$/.exec(subPath);
  if (profileMatch && method === 'DELETE') {
    await store.deleteProfile(decodeURIComponent(profileMatch[1]));
    sendJson(response, 200, { ok: true });
    return;
  }

  if (subPath === '/tts' && method === 'POST') {
    const body = (await readJsonBody(request)) as unknown as GptSovitsTtsRequest;
    const text = String(body.text ?? '').trim();
    if (!text) throw httpError('测试文本不能为空', 400);
    const profile = resolveProfile(store, body);
    const emotion = isGptSovitsEmotion(body.emotion) ? body.emotion : 'neutral';
    const out = await withLock(() => synthesize(client, store, profile, text, emotion));
    response.statusCode = 200;
    response.setHeader('Content-Type', out.contentType || 'audio/wav');
    response.setHeader('Content-Length', out.buffer.length);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(GPT_SOVITS_TTS_HEADERS.elapsedMs, String(out.elapsed));
    response.setHeader(GPT_SOVITS_TTS_HEADERS.usedEmotion, out.usedEmotion);
    response.setHeader(GPT_SOVITS_TTS_HEADERS.loadedGpt, encodeURIComponent(out.loaded.gpt));
    response.setHeader(GPT_SOVITS_TTS_HEADERS.loadedSovits, encodeURIComponent(out.loaded.sovits));
    response.end(out.buffer);
    return;
  }

  sendJson(response, 404, { error: `Unknown GPT-SoVITS route: ${subPath}` });
}

/** The provider sends a preset id; the studio page sends a whole preset. */
function resolveProfile(store: GptSovitsStore, body: GptSovitsTtsRequest): GptSovitsProfile {
  const inline = body.profile;
  if (inline && typeof inline === 'object') {
    // The studio page may send an unsaved profile (id only) — fill it from disk.
    if (inline.id && !inline.settings) return store.getProfile(inline.id) ?? inline;
    return inline;
  }
  const id = String(body.profileId ?? '').trim();
  if (!id) throw httpError('缺少角色配置', 400);
  const stored = store.getProfile(id);
  if (!stored) throw httpError(`角色不存在：${id}`, 404);
  return stored;
}

async function ensureModels(
  store: GptSovitsStore,
  client: GptSovitsClient,
  profile: Pick<GptSovitsProfile, 'models'>
): Promise<{ gpt: string; sovits: string }> {
  const loaded = store.getLoaded();
  const next = { ...loaded };
  const wantGpt = profile.models?.gpt ?? '';
  const wantSovits = profile.models?.sovits ?? '';

  if (wantGpt && wantGpt !== loaded.gpt) {
    if (!existsSync(wantGpt)) throw new GsError('GPT 权重文件不存在', 400, wantGpt);
    await client.setGptWeights(wantGpt);
    next.gpt = wantGpt;
  }
  if (wantSovits && wantSovits !== loaded.sovits) {
    if (!existsSync(wantSovits)) throw new GsError('SoVITS 权重文件不存在', 400, wantSovits);
    await client.setSovitsWeights(wantSovits);
    next.sovits = wantSovits;
  }
  if (next.gpt !== loaded.gpt || next.sovits !== loaded.sovits) {
    await store.setLoaded(next.gpt, next.sovits);
  }
  return next;
}

function buildTtsPayload(
  profile: GptSovitsProfile,
  text: string,
  emotion: GptSovitsEmotion
): { payload: Record<string, unknown>; usedEmotion: GptSovitsEmotion } {
  const references = profile.references ?? {};
  let used = emotion;
  let reference = references[used];
  if (!reference || !reference.audio) {
    if (references.neutral?.audio) {
      used = 'neutral';
      reference = references.neutral;
    } else {
      throw httpError('当前角色没有可用的参考音频，请先在 GPT-SoVITS 配置页配置「普通」参考音频', 400);
    }
  }
  if (!existsSync(reference.audio)) {
    throw httpError(`参考音频文件不存在：${reference.audio}`, 400);
  }

  const settings = { ...DEFAULT_GPT_SOVITS_SETTINGS, ...(profile.settings ?? {}) };
  return {
    usedEmotion: used,
    payload: {
      text,
      text_lang: profile.text_lang || 'zh',
      ref_audio_path: reference.audio,
      prompt_text: reference.text || '',
      prompt_lang: reference.lang || 'zh',
      top_k: Number(settings.top_k),
      top_p: Number(settings.top_p),
      temperature: Number(settings.temperature),
      speed_factor: Number(settings.speed_factor),
      text_split_method: settings.text_split_method,
      batch_size: Number(settings.batch_size),
      batch_threshold: Number(settings.batch_threshold),
      split_bucket: Boolean(settings.split_bucket),
      repetition_penalty: Number(settings.repetition_penalty),
      seed: Number(settings.seed),
      parallel_infer: Boolean(settings.parallel_infer),
      sample_steps: Number(settings.sample_steps),
      super_sampling: Boolean(settings.super_sampling),
      fragment_interval: Number(settings.fragment_interval),
      streaming_mode: 0,
      media_type: 'wav'
    }
  };
}

async function synthesize(
  client: GptSovitsClient,
  store: GptSovitsStore,
  profile: GptSovitsProfile,
  text: string,
  emotion: GptSovitsEmotion
): Promise<{
  buffer: Buffer;
  contentType: string;
  elapsed: number;
  usedEmotion: GptSovitsEmotion;
  loaded: { gpt: string; sovits: string };
}> {
  const started = Date.now();
  const loaded = await ensureModels(store, client, profile);
  const { payload, usedEmotion } = buildTtsPayload(profile, text, emotion);
  const out = await client.tts(payload);
  return { ...out, elapsed: Date.now() - started, usedEmotion, loaded };
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = (await readRequestBody(request, MAX_JSON_BYTES)).toString('utf8');
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    throw httpError('请求体不是合法 JSON', 400);
  }
}

function readFilenameHeader(request: IncomingMessage): string {
  const raw = request.headers['x-filename'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return 'ref.wav';
  try {
    // Browsers cannot send non-ASCII header values; the studio page encodes them.
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function safeFileName(name: string): string {
  const base = path
    .basename(String(name || 'ref'))
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 80);
  const extension = path.extname(base).toLowerCase();
  const stem = path.basename(base, extension).slice(0, 60) || 'ref';
  const suffix = randomBytes(4).toString('hex');
  return `${stem}-${suffix}${ALLOWED_AUDIO_EXTENSIONS.includes(extension) ? extension : '.wav'}`;
}

/** Windows paths are case-insensitive, so compare them resolved and lowered. */
function isWithin(child: string, parent: string): boolean {
  if (!parent) return false;
  const a = path.resolve(child).toLowerCase();
  const b = path.resolve(parent).toLowerCase();
  if (a === b) return true;
  const relative = path.relative(b, a);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isAllowedAudioPath(value: string, store: GptSovitsStore): boolean {
  if (typeof value !== 'string' || !value) return false;
  const absolute = path.resolve(value);
  return isWithin(absolute, store.getRoot()) || isWithin(absolute, store.referencesDir);
}

function audioContentType(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case '.mp3':
      return 'audio/mpeg';
    case '.flac':
      return 'audio/flac';
    case '.ogg':
      return 'audio/ogg';
    default:
      return 'audio/wav';
  }
}

function isGptSovitsEmotion(value: unknown): value is GptSovitsEmotion {
  return typeof value === 'string' && (GPT_SOVITS_EMOTIONS as readonly string[]).includes(value);
}

function httpError(
  message: string,
  status: number,
  detail?: string
): Error & { status: number; detail?: string } {
  const error = new Error(message) as Error & { status: number; detail?: string };
  error.status = status;
  if (detail) error.detail = detail;
  return error;
}

/**
 * Weight switching rewrites the whole 9880 process, so only one switch or
 * synthesis may run at a time.
 */
let lockChain: Promise<unknown> = Promise.resolve();
function withLock<T>(task: () => Promise<T>): Promise<T> {
  const run = lockChain.then(task, task);
  lockChain = run.catch(() => undefined);
  return run;
}
