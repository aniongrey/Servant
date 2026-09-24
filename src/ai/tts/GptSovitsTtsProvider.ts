import { synthesizeGptSovitsSpeech } from '../../app/network/gptSovitsStudio';
import type { SpeechSdkTtsProviderConfig } from './speechSdkTypes';
import type { PreparedSpeech, TtsPrepareOptions, TtsProvider, TtsSpeakOptions } from './types';
import { createTtsAbortError, playAudioBytes } from './audioPlayback';

/**
 * Speech for a locally running GPT-SoVITS (`api_v2.py` on 9880).
 *
 * The provider owns no voice settings: which weights and reference audio to use
 * is a role preset maintained on the studio page, so the voice settings only
 * pick the role id — the same slot other providers keep their `voice` in.
 * Synthesis always runs through Shiro's own backend, which is the only place
 * that may touch 9880 (and the only place that knows the role presets).
 */
export class GptSovitsTtsProvider implements TtsProvider {
  readonly id = 'gpt_sovits';
  private readonly activeControllers = new Set<AbortController>();

  constructor(private readonly config: SpeechSdkTtsProviderConfig) {}

  isSupported(): boolean {
    return Boolean(this.config.voice.trim()) && typeof globalThis.Audio === 'function';
  }

  async speak(text: string, options: TtsSpeakOptions = {}): Promise<void> {
    const prepared = await this.prepare(text, options);
    await this.play(prepared, options);
  }

  /** Requests synthesis and holds the audio; playback is a separate step. */
  async prepare(text: string, options: TtsPrepareOptions = {}): Promise<PreparedSpeech> {
    if (!this.isSupported()) {
      throw new Error('未选择 GPT-SoVITS 角色，请先在语音设置里选择一个角色。');
    }
    if (options.signal?.aborted) throw createTtsAbortError();

    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    this.activeControllers.add(controller);

    try {
      const speech = await synthesizeGptSovitsSpeech(
        { profileId: this.config.voice.trim(), text, emotion: 'neutral' },
        controller.signal
      );
      return {
        bytes: new Uint8Array(await speech.blob.arrayBuffer()),
        mediaType: speech.blob.type || 'audio/wav'
      };
    } finally {
      options.signal?.removeEventListener('abort', abort);
      this.activeControllers.delete(controller);
    }
  }

  async play(prepared: PreparedSpeech, options: TtsSpeakOptions = {}): Promise<void> {
    if (options.signal?.aborted) throw createTtsAbortError();

    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    this.activeControllers.add(controller);

    try {
      await playAudioBytes({
        bytes: prepared.bytes,
        mediaType: prepared.mediaType,
        signal: controller.signal,
        onPlaybackStart: options.onPlaybackStart,
        onLipSyncEnd: options.onLipSyncEnd
      });
    } finally {
      options.signal?.removeEventListener('abort', abort);
      this.activeControllers.delete(controller);
    }
  }

  cancel(): void {
    for (const controller of [...this.activeControllers]) controller.abort();
    this.activeControllers.clear();
  }
}
