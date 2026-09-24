import type { PreparedSpeech, TtsPrepareOptions, TtsProvider } from './types';

/**
 * Renders lines before they are due.
 *
 * Playback has to stay strictly serial — one voice, one bubble, one mouth — but
 * synthesis does not. A provider that can hand back audio without playing it
 * (`prepare` + `play`) lets the next line be rendered while the current one is
 * still speaking, which is what removes the pause between sentences.
 *
 * Results are keyed by the exact spoken text they were rendered for, so a stale
 * request can never be played as a different line, and `take` is the only way to
 * consume one. A request that fails, or that is aborted because its text lost its
 * slot, resolves to `undefined` — the caller then synthesizes on demand, so a
 * failed prefetch costs nothing but the wasted request.
 */
export class SpeechPrefetcher {
  private readonly pending = new Map<string, PendingPrefetch>();

  constructor(
    private readonly provider: TtsProvider,
    /**
     * How many lines may be in flight at once. Two covers the next sentence of
     * the current reply *and* the next reply segment, without letting a fast
     * speaker queue up requests behind a slow one.
     */
    private readonly maxPending = 2
  ) {}

  /** Starts rendering `spokenText`; repeat calls for the same text are ignored. */
  request(spokenText: string, options: TtsPrepareOptions = {}): void {
    const prepare = this.provider.prepare;
    if (!spokenText || !prepare || !this.provider.play) return;
    if (this.pending.has(spokenText)) return;

    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();

    this.pending.set(spokenText, {
      controller,
      detach: () => options.signal?.removeEventListener('abort', abort),
      audio: prepare.call(this.provider, spokenText, { signal: controller.signal }).catch(() => undefined)
    });
    this.evictOverflow();
  }

  /** Hands over the audio rendered for `spokenText`, if any is waiting. */
  take(spokenText: string): Promise<PreparedSpeech | undefined> | undefined {
    const entry = this.pending.get(spokenText);
    if (!entry) return undefined;
    this.pending.delete(spokenText);
    entry.detach();
    return entry.audio;
  }

  /** Drops everything in flight. Aborting a request never touches playback. */
  cancel(): void {
    for (const spokenText of [...this.pending.keys()]) this.drop(spokenText);
  }

  private drop(spokenText: string): void {
    const entry = this.pending.get(spokenText);
    if (!entry) return;
    this.pending.delete(spokenText);
    entry.detach();
    entry.controller.abort();
  }

  private evictOverflow(): void {
    while (this.pending.size > this.maxPending) {
      const oldest = this.pending.keys().next().value;
      if (oldest === undefined) return;
      this.drop(oldest);
    }
  }
}

interface PendingPrefetch {
  readonly controller: AbortController;
  readonly audio: Promise<PreparedSpeech | undefined>;
  readonly detach: () => void;
}
