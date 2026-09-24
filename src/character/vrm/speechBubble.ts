/**
 * Speech bubble timing, deliberately decoupled from the mouth.
 *
 * `store.speech.speaking` is the lip sync channel: it stops
 * `TRAILING_SILENCE_MS` before the audio does, so the mouth is already closed
 * while the tail of the line is still audible. That is why the bubble must not
 * read `speaking` — it owns its own timeline here:
 *
 *   audio starts ────────────────────────► audio really ends ──► hold ──► fade
 *   |<────────── bubble fully visible ─────>|<──── 5s ────>|<─ 220ms ─>|
 */

/** Rendered state of the bubble. `speaking` keeps the bubble fully opaque. */
export interface SpeechBubbleState {
  text: string;
  speaking: boolean;
}

/** How long the bubble stays readable after the audio has actually finished. */
export const SPEECH_BUBBLE_AFTER_SPEECH_MS = 5_000;

/** Fallback reading pace used when no playback receipt ever arrives. */
export const SPEECH_BUBBLE_CHARS_PER_SECOND = 3;

/** Fade-out delay before the node is unmounted. Must exceed the CSS transition. */
export const SPEECH_BUBBLE_FADE_MS = 220;

/**
 * Worst-case lifetime of an utterance, used only as a lost-end safety net for
 * remote speech that never reports playback completion.
 */
export function getSpeechBubbleDurationMs(text: string, voiceDurationMs = 0): number {
  return Math.max(
    (text.trim().length / SPEECH_BUBBLE_CHARS_PER_SECOND) * 1000,
    voiceDurationMs + SPEECH_BUBBLE_AFTER_SPEECH_MS
  );
}

export interface SpeechBubbleTimelineOptions {
  onChange: (state: SpeechBubbleState) => void;
  /** Readable hold after the audio ends. Defaults to {@link SPEECH_BUBBLE_AFTER_SPEECH_MS}. */
  holdMs?: number;
  /** Fade-out delay before the node is unmounted. Defaults to {@link SPEECH_BUBBLE_FADE_MS}. */
  fadeMs?: number;
}

/**
 * Owns the visible lifetime of one bubble, independent of which path feeds it
 * (local TTS store state or remote `action.voice` broadcasts).
 */
export class SpeechBubbleTimeline {
  private text = '';
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private fadeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: SpeechBubbleTimelineOptions) {}

  /** Audio is playing: show the text and keep the bubble opaque. */
  show(text: string): void {
    this.clearTimers();
    this.text = text;
    this.options.onChange({ text, speaking: true });
  }

  /** Audio has actually finished: stay readable for the hold, then fade out. */
  finish(): void {
    if (!this.text) return;
    this.clearTimers();
    this.hideTimer = setTimeout(() => this.fadeOut(), this.options.holdMs ?? SPEECH_BUBBLE_AFTER_SPEECH_MS);
  }

  /** Safety net: hide after `durationMs` unless a real completion arrives first. */
  hideAfter(durationMs: number): void {
    if (!this.text) return;
    this.clearTimers();
    this.hideTimer = setTimeout(() => this.hide(), Math.max(0, durationMs));
  }

  /** Hide immediately (speech was cancelled). */
  hide(): void {
    this.clearTimers();
    this.text = '';
    this.options.onChange({ text: '', speaking: false });
  }

  dispose(): void {
    this.clearTimers();
    this.text = '';
  }

  private fadeOut(): void {
    this.fadeTimer = setTimeout(() => this.hide(), this.options.fadeMs ?? SPEECH_BUBBLE_FADE_MS);
    this.options.onChange({ text: this.text, speaking: false });
  }

  private clearTimers(): void {
    clearTimeout(this.hideTimer);
    clearTimeout(this.fadeTimer);
    this.hideTimer = undefined;
    this.fadeTimer = undefined;
  }
}
