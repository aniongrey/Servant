import { backendFetch } from './backendFetch.ts';
import {
  GPT_SOVITS_API_PREFIX,
  GPT_SOVITS_TTS_HEADERS,
  type GptSovitsHealth,
  type GptSovitsState,
  type GptSovitsTtsRequest
} from './gptSovitsContract.ts';

/**
 * Frontend access to the local GPT-SoVITS integration.
 *
 * Every call goes through `backendFetch`, so the studio page and the voice
 * settings reach the sidecar on its random loopback port once packaged instead
 * of hitting Tauri's asset protocol with a page-relative `/api/*` URL.
 */

export async function fetchGptSovitsState(signal?: AbortSignal): Promise<GptSovitsState> {
  const response = await backendFetch(`${GPT_SOVITS_API_PREFIX}/state`, { signal });
  return (await readJson(response)) as GptSovitsState;
}

export async function fetchGptSovitsHealth(signal?: AbortSignal): Promise<GptSovitsHealth> {
  const response = await backendFetch(`${GPT_SOVITS_API_PREFIX}/health`, { signal });
  return (await readJson(response)) as GptSovitsHealth;
}

export interface GptSovitsSpeech {
  blob: Blob;
  /** Reported by the backend; falls back to the round-trip time. */
  elapsedMs: number;
  usedEmotion: string;
}

export async function synthesizeGptSovitsSpeech(
  request: GptSovitsTtsRequest,
  signal?: AbortSignal
): Promise<GptSovitsSpeech> {
  const started = Date.now();
  const response = await backendFetch(`${GPT_SOVITS_API_PREFIX}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal
  });
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || contentType.includes('application/json')) {
    const body = (await response.json().catch(() => null)) as { error?: string; detail?: string } | null;
    throw new Error([body?.error, body?.detail].filter(Boolean).join(' | ') || `HTTP ${response.status}`);
  }
  const elapsedHeader = Number(response.headers.get(GPT_SOVITS_TTS_HEADERS.elapsedMs));
  return {
    blob: await response.blob(),
    elapsedMs: Number.isFinite(elapsedHeader) && elapsedHeader > 0 ? elapsedHeader : Date.now() - started,
    usedEmotion: response.headers.get(GPT_SOVITS_TTS_HEADERS.usedEmotion) ?? ''
  };
}

async function readJson(response: Response): Promise<unknown> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(body?.error?.trim() || `HTTP ${response.status}`);
  return body;
}
