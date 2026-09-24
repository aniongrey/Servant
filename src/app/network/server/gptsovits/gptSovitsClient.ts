import type { GptSovitsHealth } from '../../gptSovitsContract.ts';

/**
 * HTTP client for GPT-SoVITS `api_v2.py`.
 *
 * Ported from the `gpt-sovtest` prototype. It only proxies the official
 * contract — `/openapi.json` for the probe, `/set_*_weights` for weight
 * switching and `/tts` for synthesis — and never touches GPT-SoVITS itself.
 */

export class GsError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(message: string, status = 502, detail = '') {
    super(message);
    this.name = 'GsError';
    this.status = status;
    this.detail = detail;
  }
}

const HEALTH_TIMEOUT_MS = 6_000;
const WEIGHTS_TIMEOUT_MS = 180_000;
const TTS_TIMEOUT_MS = 600_000;

export class GptSovitsClient {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    const raw = (baseUrl ?? process.env.GPT_SOVITS_URL ?? 'http://127.0.0.1:9880').trim();
    this.baseUrl = raw.replace(/\/+$/, '');
  }

  /** Address the client talks to; surfaced by `/state` so the UI can show it. */
  get apiUrl(): string {
    return this.baseUrl;
  }

  /** `GET /openapi.json` — cheap probe that never depends on loaded weights. */
  async health(): Promise<GptSovitsHealth> {
    try {
      const response = await fetch(`${this.baseUrl}/openapi.json`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
      });
      if (!response.ok) {
        return { connected: false, description: `9880 返回 HTTP ${response.status}` };
      }
      const body = (await response.json()) as {
        info?: { title?: string; version?: string };
        paths?: Record<string, unknown>;
      };
      return {
        connected: true,
        description: body.info?.title || 'GPT-SoVITS API',
        version: body.info?.version || '',
        schema: body.paths ? Object.keys(body.paths) : null
      };
    } catch (cause) {
      const reason =
        cause instanceof Error && cause.name === 'TimeoutError'
          ? '连接超时'
          : cause instanceof Error
          ? cause.message
          : String(cause);
      return { connected: false, description: `无法连接 9880：${reason}` };
    }
  }

  setGptWeights(weightsPath: string): Promise<unknown> {
    return this.setWeights('gpt', weightsPath);
  }

  setSovitsWeights(weightsPath: string): Promise<unknown> {
    return this.setWeights('sovits', weightsPath);
  }

  /** `POST /tts` — resolves with the whole audio body, rejects with a `GsError`. */
  async tts(payload: Record<string, unknown>): Promise<{ buffer: Buffer; contentType: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TTS_TIMEOUT_MS)
      });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || contentType.includes('application/json')) {
        const detail = await readUpstreamError(response);
        throw new GsError(
          `语音生成失败（HTTP ${response.status}）`,
          response.status >= 400 ? response.status : 502,
          detail
        );
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) throw new GsError('语音生成返回空音频');
      return { buffer, contentType: contentType || 'audio/wav' };
    } catch (cause) {
      if (cause instanceof GsError) throw cause;
      const reason = describeFailure(cause, '生成超时（超过 10 分钟）');
      throw new GsError(`语音生成失败：${reason}`);
    }
  }

  private async setWeights(which: 'gpt' | 'sovits', weightsPath: string): Promise<unknown> {
    const endpoint = which === 'gpt' ? '/set_gpt_weights' : '/set_sovits_weights';
    const url = `${this.baseUrl}${endpoint}?weights_path=${encodeURIComponent(weightsPath)}`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(WEIGHTS_TIMEOUT_MS) });
      if (!response.ok) {
        const detail = await readUpstreamError(response);
        throw new GsError(`切换 ${which} 权重失败（HTTP ${response.status}）`, response.status, detail);
      }
      const body = (await response.json().catch(() => null)) as {
        success?: boolean;
        code?: number;
        message?: string;
        detail?: string;
      } | null;
      // Some versions answer 200 while reporting the failure in the body.
      if (body && (body.success === false || (body.code !== undefined && body.code !== 0))) {
        throw new GsError(
          `切换 ${which} 权重被拒绝`,
          502,
          body.message || body.detail || JSON.stringify(body)
        );
      }
      return body ?? { message: 'success' };
    } catch (cause) {
      if (cause instanceof GsError) throw cause;
      const reason = describeFailure(cause, '切换权重超时');
      throw new GsError(`切换 ${which} 权重失败：${reason}`);
    }
  }
}

function describeFailure(cause: unknown, timeoutMessage: string): string {
  if (cause instanceof Error && cause.name === 'TimeoutError') return timeoutMessage;
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * `api_v2.py` reports the useful cause in `Exception`, while `message` stays a
 * generic "tts failed" — surface both, otherwise every failure looks identical.
 */
async function readUpstreamError(response: Response): Promise<string> {
  let text = '';
  try {
    text = await response.text();
  } catch {
    return '';
  }
  try {
    const body = JSON.parse(text) as {
      Exception?: string;
      exception?: string;
      detail?: string;
      message?: string;
      msg?: string;
    };
    return (
      [body.Exception, body.exception, body.detail, body.message, body.msg]
        .filter((value) => typeof value === 'string' && value.trim())
        .join(' | ') || JSON.stringify(body)
    );
  } catch {
    return text.slice(0, 800);
  }
}
