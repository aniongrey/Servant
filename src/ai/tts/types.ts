export interface TtsVoiceOptions {
  lang?: string;
  voiceName?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
}

export interface TtsSpeakOptions extends TtsVoiceOptions {
  signal?: AbortSignal;
  onPlaybackStart?: () => void;
  onLipSyncEnd?: () => void;
}

/**
 * Audio that exists but has not been played yet. Only providers that can hand
 * their bytes back before playing them produce one (see `TtsProvider.prepare`).
 */
export interface PreparedSpeech {
  bytes: Uint8Array;
  mediaType: string;
}

/** `prepare` renders audio; it never plays, so playback callbacks do not apply. */
export type TtsPrepareOptions = Pick<TtsSpeakOptions, 'signal'>;

export interface TtsProvider {
  readonly id: string;
  isSupported(): boolean;
  speak(text: string, options?: TtsSpeakOptions): Promise<void>;
  /**
   * Optional synthesis-only path: renders `text` and returns the audio without
   * playing it. Providers implement this together with `play` when playback is
   * a separate step (network TTS: synthesize, then feed the audio element), so a
   * caller can render the next line while the current one is still speaking.
   *
   * Providers whose synthesis and playback cannot be separated (browser speech
   * synthesis) leave both undefined; callers fall back to `speak`.
   */
  prepare?(text: string, options?: TtsPrepareOptions): Promise<PreparedSpeech>;
  /** Plays audio produced by `prepare`. Must reject with an AbortError on abort. */
  play?(prepared: PreparedSpeech, options?: TtsSpeakOptions): Promise<void>;
  cancel(): void;
}

export interface TtsTurnOptions extends TtsVoiceOptions {
  intent?: string;
  signal?: AbortSignal;
  onPlaybackStart?: () => void;
}

export interface TtsTurn {
  readonly done: Promise<void>;
  push(partialSpeech: string): void;
  finish(finalSpeech: string, spokenSpeech?: string): Promise<void>;
  cancel(): void;
}
