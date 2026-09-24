import { generateSpeech } from '@speech-sdk/core';
import {
  createCartesia,
  createDeepgram,
  createElevenLabs,
  createFal,
  createFishAudio,
  createGoogle,
  createGradium,
  createHume,
  createInworld,
  createMiniMax,
  createMistral,
  createMurf,
  createOpenAI,
  createResemble,
  createSmallestAI,
  createSpeechify,
  createXai
} from '@speech-sdk/core/providers';
import type { GenerateSpeechOptions, ResolvedModel } from '@speech-sdk/core/types';
import type { PreparedSpeech, TtsPrepareOptions, TtsProvider, TtsSpeakOptions } from './types';
import { isSpeechSdkTtsConfigComplete } from './speechSdkTtsConfig';
import { speechSdkModelSupportsInstructions } from './speechSdkProviderOptions';
import type { SpeechSdkTtsProviderConfig } from './speechSdkTypes';
import { createTtsAbortError, playAudioBytes } from './audioPlayback';

export { defaultSpeechSdkTtsProviderConfig, normalizeSpeechSdkTtsProviderConfig } from './speechSdkTtsConfig';
export { type SpeechSdkTtsLanguage, type SpeechSdkTtsProviderConfig } from './speechSdkTypes';

export interface SpeechSdkTtsRuntimeOptions {
  fetch?: typeof globalThis.fetch;
}

export class SpeechSdkTtsProvider implements TtsProvider {
  readonly id = 'speech_sdk';
  private readonly activeControllers = new Set<AbortController>();

  constructor(
    private readonly config: SpeechSdkTtsProviderConfig,
    private readonly runtimeOptions: SpeechSdkTtsRuntimeOptions = {}
  ) {}

  isSupported(): boolean {
    return isSpeechSdkTtsConfigComplete(this.config) && Boolean(globalThis.fetch);
  }

  async speak(text: string, options: TtsSpeakOptions = {}): Promise<void> {
    const prepared = await this.prepare(text, options);
    await this.play(prepared, options);
  }

  /** Renders `text` and returns the audio; playback is a separate step. */
  async prepare(text: string, options: TtsPrepareOptions = {}): Promise<PreparedSpeech> {
    if (!this.isSupported()) {
      throw new Error('TTS 配置不完整，请检查 API Key、模型和音色。');
    }
    if (options.signal?.aborted) {
      throw createTtsAbortError();
    }

    const request = this.beginRequest(options.signal);
    try {
      if (this.config.provider === 'doubao') {
        if (typeof globalThis.WebSocket === 'function') {
          return await generateDoubaoSpeechWebSocket(this.config, text, request.signal);
        }
        return await generateDoubaoSpeech(
          this.config,
          text,
          request.signal,
          this.runtimeOptions.fetch ?? globalThis.fetch
        );
      }

      const model = createSpeechSdkModel(this.config, this.runtimeOptions.fetch);
      const result = await generateSpeech({
        model,
        text,
        voice: this.config.voice.trim(),
        apiKey: typeof model === 'string' ? this.config.apiKey?.trim() || undefined : undefined,
        instructions: speechSdkModelSupportsInstructions(this.config)
          ? this.config.instructions.trim() || undefined
          : undefined,
        speed: this.config.speed,
        output: { format: this.config.outputFormat },
        abortSignal: request.signal
      } satisfies GenerateSpeechOptions);

      return { bytes: result.audio.uint8Array, mediaType: result.audio.mediaType };
    } finally {
      request.release();
    }
  }

  async play(prepared: PreparedSpeech, options: TtsSpeakOptions = {}): Promise<void> {
    if (options.signal?.aborted) throw createTtsAbortError();

    const request = this.beginRequest(options.signal);
    try {
      await playAudioBytes({
        bytes: prepared.bytes,
        mediaType: prepared.mediaType,
        signal: request.signal,
        onPlaybackStart: options.onPlaybackStart,
        onLipSyncEnd: options.onLipSyncEnd
      });
    } finally {
      request.release();
    }
  }

  /**
   * Ties one network utterance to the caller's signal. Aborting the caller — or
   * `cancel()` — must tear down that utterance's audio, so each request owns a
   * controller that stays registered until it settles.
   */
  private beginRequest(signal?: AbortSignal): { signal: AbortSignal; release: () => void } {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    this.activeControllers.add(controller);
    return {
      signal: controller.signal,
      release: () => {
        signal?.removeEventListener('abort', abort);
        this.activeControllers.delete(controller);
      }
    };
  }

  cancel(): void {
    // Aborting the per-utterance controller is what stops playback: the shared
    // player listens on the same signal and tears the audio element down.
    for (const controller of [...this.activeControllers]) controller.abort();
    this.activeControllers.clear();
  }
}

async function generateDoubaoSpeechWebSocket(
  config: SpeechSdkTtsProviderConfig,
  text: string,
  signal: AbortSignal
): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const protocol = globalThis.location?.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = globalThis.location?.host || 'localhost';
  const socket = new WebSocket(`${protocol}//${host}/api/doubao-tts/ws`);
  socket.binaryType = 'arraybuffer';
  const audio: Uint8Array[] = [];
  let settled = false;
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
      if (error) reject(error);
      else {
        const bytes = new Uint8Array(audio.reduce((size, chunk) => size + chunk.length, 0));
        let offset = 0;
        for (const chunk of audio) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        if (!bytes.length) {
          reject(new Error('豆包语音返回成功，但没有收到可播放的音频数据。'));
          return;
        }
        resolve({
          bytes,
          mediaType:
            config.outputFormat === 'wav'
              ? 'audio/wav'
              : config.outputFormat === 'pcm'
              ? 'audio/pcm'
              : 'audio/mpeg'
        });
      }
    };
    const abort = () => finish(new DOMException('Speech SDK speech was aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    socket.onopen = () => {
      socket.send(JSON.stringify({ apiKey: config.apiKey.trim(), resourceId: config.model.trim() }));
      socket.send(
        buildDoubaoV3RequestFrame({
          user: { uid: 'codex-list' },
          req_params: {
            text,
            speaker: config.voice.trim(),
            audio_params: {
              format: config.outputFormat,
              sample_rate: config.sampleRate,
              speech_rate: Math.round((config.speed - 1) * 100),
              loudness_rate: config.loudnessRate,
              pitch_rate: config.pitchRate
            }
          }
        })
      );
    };
    socket.onmessage = async (event) => {
      const frame =
        event.data instanceof ArrayBuffer
          ? new Uint8Array(event.data)
          : new Uint8Array(await (event.data as Blob).arrayBuffer());
      const parsed = parseDoubaoV3Frame(frame);
      if (parsed.event === 352 && parsed.payload.length) audio.push(parsed.payload);
      if (parsed.event === 153 || parsed.event === 51) finish(new Error('豆包语音 WebSocket 会话失败。'));
      if (parsed.event === 152) finish();
    };
    socket.onerror = () => finish(new Error('豆包语音 WebSocket 连接失败。'));
    socket.onclose = () => {
      if (!settled) finish(new Error('豆包语音 WebSocket 连接已关闭。'));
    };
  });
}

function buildDoubaoV3RequestFrame(payload: unknown): ArrayBuffer {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const frame = new Uint8Array(8 + bytes.length);
  frame.set([0x11, 0x10, 0x10, 0x00], 0);
  new DataView(frame.buffer).setUint32(4, bytes.length, false);
  frame.set(bytes, 8);
  return frame.buffer;
}

export function parseDoubaoV3Frame(frame: Uint8Array): {
  event: number;
  sessionId: string;
  payload: Uint8Array;
} {
  if (frame.length < 12) return { event: 0, sessionId: '', payload: new Uint8Array() };
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const event = view.getUint32(4, false);
  const sessionLength = view.getUint32(8, false);
  const sessionStart = 12;
  const sessionEnd = Math.min(frame.length, sessionStart + sessionLength);
  const payloadLengthOffset = sessionEnd;
  const payloadStart = payloadLengthOffset + 4;
  const declaredLength =
    payloadLengthOffset + 4 <= frame.length ? view.getUint32(payloadLengthOffset, false) : 0;
  const payloadEnd = declaredLength ? Math.min(frame.length, payloadStart + declaredLength) : frame.length;
  let payload = payloadStart <= frame.length ? frame.slice(payloadStart, payloadEnd) : new Uint8Array();
  const serialization = (frame[2] >> 4) & 0x0f;
  if (serialization === 1 && payload.length) {
    try {
      const json = JSON.parse(new TextDecoder().decode(payload)) as { data?: string; audio?: string };
      const encoded = json.data ?? json.audio;
      if (encoded) payload = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    } catch {
      // Some sentence metadata events are marked as JSON but are not valid JSON.
    }
  }
  return {
    event,
    sessionId: new TextDecoder().decode(frame.slice(sessionStart, sessionEnd)),
    payload
  };
}

interface DoubaoTtsResponse {
  code?: number | string;
  message?: string;
  audio?: string;
  url?: string;
  data?: string;
}

export async function generateDoubaoSpeech(
  config: SpeechSdkTtsProviderConfig,
  text: string,
  signal: AbortSignal,
  fetchImpl: typeof globalThis.fetch
): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const timeoutController = new AbortController();
  const abort = () => timeoutController.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => timeoutController.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(config.apiBase.trim(), {
      method: 'POST',
      headers: {
        'X-Api-Key': config.apiKey.trim(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model.trim(),
        text_prompt: text,
        ...(config.voice.trim() ? { references: [{ speaker: config.voice.trim() }] } : {}),
        audio_config: {
          format: config.outputFormat,
          sample_rate: config.sampleRate,
          speech_rate: Math.round((config.speed - 1) * 100),
          loudness_rate: config.loudnessRate,
          pitch_rate: config.pitchRate
        },
        watermark: {}
      }),
      signal: timeoutController.signal
    });

    const payload = (await response.json()) as DoubaoTtsResponse;
    if (!response.ok || (payload.code !== undefined && payload.code !== 0 && payload.code !== '0')) {
      throw new Error(payload.message?.trim() || `豆包语音请求失败（HTTP ${response.status}）`);
    }

    let encodedAudio = payload.audio ?? payload.data;
    if (!encodedAudio && payload.url) {
      const audioResponse = await fetchImpl(payload.url, { signal: timeoutController.signal });
      if (!audioResponse.ok) throw new Error(`豆包语音音频下载失败（HTTP ${audioResponse.status}）`);
      const bytes = new Uint8Array(await audioResponse.arrayBuffer());
      return { bytes, mediaType: audioResponse.headers.get('content-type') ?? 'audio/mpeg' };
    }
    if (!encodedAudio) throw new Error(payload.message?.trim() || '豆包语音响应中没有音频数据。');
    const binary = atob(encodedAudio);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return {
      bytes,
      mediaType:
        config.outputFormat === 'mp3'
          ? 'audio/mpeg'
          : config.outputFormat === 'wav'
          ? 'audio/wav'
          : 'audio/pcm'
    };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}

function createSpeechSdkModel(
  config: SpeechSdkTtsProviderConfig,
  networkFetch: typeof globalThis.fetch | undefined
): string | ResolvedModel<string> {
  const modelId = config.model.trim();
  if (!networkFetch) return `${config.provider}/${modelId}`;

  const providerConfig = {
    apiKey: config.apiKey?.trim() || undefined,
    fetch: networkFetch
  };

  switch (config.provider) {
    case 'openai':
      return createOpenAI(providerConfig)(modelId);
    case 'elevenlabs':
      return createElevenLabs(providerConfig)(modelId);
    case 'deepgram':
      return createDeepgram(providerConfig)(modelId);
    case 'google':
      return createGoogle(providerConfig)(modelId);
    case 'cartesia':
      return createCartesia(providerConfig)(modelId);
    case 'fal':
      return createFal(providerConfig)(modelId);
    case 'fish':
      return createFishAudio(providerConfig)(modelId);
    case 'gradium':
      return createGradium(providerConfig)(modelId);
    case 'hume':
      return createHume(providerConfig)(modelId);
    case 'inworld':
      return createInworld(providerConfig)(modelId);
    case 'minimax':
      return createMiniMax(providerConfig)(modelId);
    case 'mistral':
      return createMistral(providerConfig)(modelId);
    case 'murf':
      return createMurf(providerConfig)(modelId);
    case 'resemble':
      return createResemble(providerConfig)(modelId);
    case 'smallestai':
      return createSmallestAI(providerConfig)(modelId);
    case 'speechify':
      return createSpeechify(providerConfig)(modelId);
    case 'xai':
      return createXai(providerConfig)(modelId);
    default:
      return `${config.provider}/${modelId}`;
  }
}
