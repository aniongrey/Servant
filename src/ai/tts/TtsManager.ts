import type { RuntimeStore } from '../../app/state/RuntimeStore';
import { SpeechPrefetcher } from './SpeechPrefetcher';
import { StreamingTextSegmenter } from './StreamingTextSegmenter';
import type { PreparedSpeech, TtsProvider, TtsSpeakOptions, TtsTurn, TtsTurnOptions } from './types';

export class TtsManager {
  private activeTurn?: ManagedTtsTurn;
  private prefetcher: SpeechPrefetcher;

  constructor(private provider: TtsProvider, private readonly store: RuntimeStore) {
    this.prefetcher = new SpeechPrefetcher(provider);
  }

  get providerId(): string {
    return this.provider.id;
  }

  setProvider(provider: TtsProvider): void {
    if (provider === this.provider) return;
    this.cancel();
    this.provider = provider;
    this.prefetcher = new SpeechPrefetcher(provider);
  }

  startTurn(options: TtsTurnOptions = {}): TtsTurn {
    this.cancelActiveTurn();
    const turn = new ManagedTtsTurn(
      this.provider,
      this.prefetcher,
      options,
      (text) => {
        if (this.activeTurn !== turn) return;
        this.store.patch({
          speech: { intent: options.intent, text, speaking: true, bubbleVisible: true }
        });
      },
      () => {
        if (this.activeTurn !== turn) return;
        const speech = this.store.getSnapshot().speech;
        // Lip sync only: the bubble keeps covering the remaining audio tail.
        if (!speech.speaking) return;
        this.store.patch({ speech: { ...speech, speaking: false } });
      },
      (finalText) => {
        if (this.activeTurn !== turn) return;
        const speech = this.store.getSnapshot().speech;
        this.store.patch({
          speech: {
            intent: options.intent,
            text: finalText || speech.text,
            speaking: false,
            bubbleVisible: false
          }
        });
        this.activeTurn = undefined;
      },
      (error) => this.store.appendLog(error.message, 'error')
    );
    this.activeTurn = turn;
    return turn;
  }

  speak(text: string, options: TtsTurnOptions = {}): Promise<void> {
    return this.startTurn(options).finish(text);
  }

  /**
   * Renders `spokenText` before it is due — typically the next reply segment
   * while the current one is still speaking. Only cancelling the active turn
   * stops it: a turn that ended normally leaves the audio in the prefetcher for
   * whoever speaks that line next, which is the whole point.
   */
  prefetchSpeech(spokenText: string): void {
    const signal = this.activeTurn?.signal;
    this.prefetcher.request(spokenText, signal ? { signal } : {});
  }

  cancel(): void {
    this.cancelActiveTurn();
    this.prefetcher.cancel();
    this.provider.cancel();
    this.clearSpeechState();
  }

  isSupported(): boolean {
    return this.provider.isSupported();
  }

  /**
   * Drops the turn in flight without touching the provider: its own utterances
   * already die with its abort signal. Starting a new turn must not be a global
   * stop — that is what `cancel()` is for — otherwise it would also kill the
   * synthesis already running for the next line.
   */
  private cancelActiveTurn(): void {
    const turn = this.activeTurn;
    this.activeTurn = undefined;
    turn?.cancel();
    this.clearSpeechState();
  }

  private clearSpeechState(): void {
    const speech = this.store.getSnapshot().speech;
    if (!speech.speaking && !speech.bubbleVisible) return;
    this.store.patch({ speech: { ...speech, speaking: false, bubbleVisible: false } });
  }
}

/**
 * One spoken turn. It reports two independent timelines back to `TtsManager`:
 * `onLipSyncEnd` closes the mouth before the audio tail (see `TRAILING_SILENCE_MS`),
 * while `onComplete` marks the real end of playback and therefore the bubble.
 *
 * Its queue is strictly serial — the next line only starts once the previous one
 * finished playing — but it asks `SpeechPrefetcher` to render that next line
 * early, so waiting for synthesis is not part of the gap between two lines.
 */
class ManagedTtsTurn implements TtsTurn {
  readonly done: Promise<void>;
  private readonly segmenter = new StreamingTextSegmenter();
  private readonly controller = new AbortController();
  private readonly queue: QueuedSpeechSegment[] = [];
  private readonly resolveDone: () => void;
  private externalAbort?: () => void;
  private pumping = false;
  private closed = false;
  private canceled = false;
  private completed = false;
  private playbackStarted = false;
  private finalText = '';

  constructor(
    private readonly provider: TtsProvider,
    private readonly prefetcher: SpeechPrefetcher,
    private readonly options: TtsTurnOptions,
    private readonly onSegmentStart: (text: string) => void,
    private readonly onLipSyncEnd: () => void,
    private readonly onComplete: (finalText: string) => void,
    private readonly onError: (error: Error) => void
  ) {
    let resolveDone!: () => void;
    this.done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    this.resolveDone = resolveDone;

    if (options.signal) {
      this.externalAbort = () => this.cancel();
      options.signal.addEventListener('abort', this.externalAbort, { once: true });
      if (options.signal.aborted) this.cancel();
    }
  }

  /** The provider requests for this turn's audio die with this signal. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  push(partialSpeech: string): void {
    if (this.closed || this.canceled) return;
    this.finalText = partialSpeech;
    this.enqueue(this.segmenter.push(partialSpeech));
  }

  finish(finalSpeech: string, spokenSpeech = finalSpeech): Promise<void> {
    if (this.closed || this.canceled) return this.done;
    this.finalText = finalSpeech.trim();
    this.enqueue(this.segmenter.flush(spokenSpeech), this.finalText);
    this.closed = true;
    this.pump();
    this.completeIfReady();
    return this.done;
  }

  cancel(): void {
    if (this.canceled) return;
    this.canceled = true;
    this.queue.length = 0;
    this.controller.abort();
    this.provider.cancel();
    this.complete();
  }

  private enqueue(segments: string[], displayText?: string): void {
    if (segments.length === 0 || this.canceled) return;
    this.queue.push(
      ...segments.map((segment) => ({
        spokenText: segment,
        displayText: displayText ?? segment
      }))
    );
    // A line that arrives while the previous one is already speaking (streaming
    // `push`) has no playback-start moment of its own to hang the lookahead on.
    this.startLookahead();
    this.pump();
  }

  private pump(): void {
    if (!this.provider.isSupported()) {
      this.queue.length = 0;
      this.completeIfReady();
      return;
    }
    if (this.pumping || this.canceled) {
      this.completeIfReady();
      return;
    }
    this.pumping = true;
    void this.runQueue();
  }

  private async runQueue(): Promise<void> {
    try {
      while (!this.canceled) {
        const segment = this.queue.shift();
        if (!segment) break;
        const audio = this.prefetcher.take(segment.spokenText);
        // Only a prefetched line may wait here: a turn with nothing rendered
        // ahead must still hand its line to the provider synchronously.
        const prepared = audio ? await audio : undefined;
        if (this.canceled) break;
        await this.playSegment(segment, prepared);
      }
    } catch (cause) {
      if (!this.canceled && !isAbortError(cause)) {
        this.onError(cause instanceof Error ? cause : new Error(String(cause)));
      }
    } finally {
      this.pumping = false;
      if (!this.canceled && this.queue.length > 0) this.pump();
      this.completeIfReady();
    }
  }

  /**
   * Renders the head of the queue while the current line is still speaking.
   * Playback stays serial — one voice, one bubble — but synthesis overlaps it,
   * and the lookahead lives in the prefetcher rather than in `queue`, so it can
   * never make `onLipSyncEnd` believe another line is still waiting to play.
   */
  private startLookahead(): void {
    const head = this.queue[0];
    if (head) this.prefetcher.request(head.spokenText, { signal: this.controller.signal });
  }

  private async playSegment(segment: QueuedSpeechSegment, prepared?: PreparedSpeech): Promise<void> {
    let segmentPlaybackStarted = false;
    const options: TtsSpeakOptions = {
      lang: this.options.lang,
      voiceName: this.options.voiceName,
      rate: this.options.rate,
      pitch: this.options.pitch,
      volume: this.options.volume,
      signal: this.controller.signal,
      onLipSyncEnd: () => {
        if (this.closed && this.queue.length === 0) this.onLipSyncEnd();
      },
      onPlaybackStart: () => {
        if (!segmentPlaybackStarted) {
          segmentPlaybackStarted = true;
          this.onSegmentStart(segment.displayText);
        }
        if (!this.playbackStarted) {
          this.playbackStarted = true;
          this.options.onPlaybackStart?.();
        }
        this.startLookahead();
      }
    };
    if (prepared && this.provider.play) return this.provider.play(prepared, options);
    return this.provider.speak(segment.spokenText, options);
  }

  private completeIfReady(): void {
    if (this.canceled || (this.closed && !this.pumping && this.queue.length === 0)) {
      this.complete();
    }
  }

  private complete(): void {
    if (this.completed) return;
    this.completed = true;
    if (this.externalAbort && this.options.signal) {
      this.options.signal.removeEventListener('abort', this.externalAbort);
      this.externalAbort = undefined;
    }
    this.onComplete(this.finalText);
    this.resolveDone();
  }
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

/** `spokenText` reaches the provider, `displayText` reaches the bubble. */
interface QueuedSpeechSegment {
  readonly spokenText: string;
  readonly displayText: string;
}
