import type { RuntimeStore } from '../../app/state/RuntimeStore';
import type { TtsManager } from './TtsManager';
import type { TtsTurn, TtsTurnOptions } from './types';
import type { RuntimeContext, SpeechTextProvider } from '../../app/runtimeTypes';
import { delay, throwIfAborted } from '../../app/utils/delay';

export type SpeechCatalog = Record<string, string[]>;

export class SpeechController {
  private readonly provider: SpeechTextProvider;
  private pendingTranslation?: AbortController;

  constructor(
    catalogOrProvider: SpeechCatalog | SpeechTextProvider,
    private readonly store: RuntimeStore,
    private readonly baseDurationMs = 520,
    private readonly tts?: TtsManager,
    private readonly resolveSpokenText?: (text: string, signal?: AbortSignal) => Promise<string>
  ) {
    this.provider = isSpeechTextProvider(catalogOrProvider)
      ? catalogOrProvider
      : new CatalogSpeechTextProvider(catalogOrProvider);
  }

  async say(intent: string, maxChars?: number, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const text = await this.provider.getLine(intent, contextFromStore(this.store), maxChars, signal);

    await this.sayText(text, { intent, signal });
  }

  async sayText(text: string, options: TtsTurnOptions = {}): Promise<void> {
    this.cancelPendingTranslation();
    throwIfAborted(options.signal);
    if (this.tts?.isSupported()) {
      await this.tts.speak(text, options);
      return;
    }

    this.store.patch({
      speech: { intent: options.intent, text, speaking: true, bubbleVisible: true }
    });
    try {
      await delay(Math.min(1800, this.baseDurationMs + text.length * 28), options.signal);
    } finally {
      this.store.patch({
        speech: { intent: options.intent, text, speaking: false, bubbleVisible: false }
      });
    }
  }

  async sayLocalizedText(text: string, options: TtsTurnOptions = {}): Promise<void> {
    throwIfAborted(options.signal);
    if (!this.resolveSpokenText || !this.tts?.isSupported()) return this.sayText(text, options);
    this.cancel();
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    this.pendingTranslation = controller;
    try {
      const spokenText = await this.resolveSpokenText(text, controller.signal);
      throwIfAborted(controller.signal);
      this.pendingTranslation = undefined;
      await this.startStreaming(options).finish(text, spokenText);
    } finally {
      options.signal?.removeEventListener('abort', abort);
      if (this.pendingTranslation === controller) this.pendingTranslation = undefined;
    }
  }

  startStreaming(options: TtsTurnOptions = {}): TtsTurn {
    this.cancelPendingTranslation();
    if (!this.tts?.isSupported()) return new TimedSpeechTurn(this, options);
    return this.tts.startTurn(options);
  }

  cancel(): void {
    this.cancelPendingTranslation();
    this.tts?.cancel();
  }

  /**
   * Renders a line that is not due yet — normally the next reply segment, while
   * the current one is still speaking. No-op when the active provider cannot
   * hand back audio before playing it.
   */
  prefetchSpeech(spokenText: string): void {
    this.tts?.prefetchSpeech(spokenText);
  }

  private cancelPendingTranslation(): void {
    this.pendingTranslation?.abort();
    this.pendingTranslation = undefined;
  }
}

class TimedSpeechTurn implements TtsTurn {
  readonly done: Promise<void>;
  private readonly resolveDone: () => void;
  private latestText = '';
  private closed = false;

  constructor(private readonly controller: SpeechController, private readonly options: TtsTurnOptions) {
    let resolveDone!: () => void;
    this.done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    this.resolveDone = resolveDone;
  }

  push(partialSpeech: string): void {
    if (!this.closed) this.latestText = partialSpeech;
  }

  finish(finalSpeech: string, _spokenSpeech = finalSpeech): Promise<void> {
    if (this.closed) return this.done;
    this.closed = true;
    this.latestText = finalSpeech || this.latestText;
    this.options.onPlaybackStart?.();
    void this.controller.sayText(this.latestText, this.options).finally(this.resolveDone);
    return this.done;
  }

  cancel(): void {
    if (this.closed) return;
    this.closed = true;
    this.resolveDone();
  }
}

export class CatalogSpeechTextProvider implements SpeechTextProvider {
  constructor(private readonly catalog: SpeechCatalog) {}

  async getLine(
    intent: string,
    _context: RuntimeContext,
    maxChars?: number,
    signal?: AbortSignal
  ): Promise<string> {
    throwIfAborted(signal);
    return clampText(this.pick(intent), maxChars);
  }

  private pick(intent: string): string {
    const lines = this.catalog[intent];
    if (!lines || lines.length === 0) {
      return `(${intent})`;
    }
    return lines[0] ?? `(${intent})`;
  }
}

function isSpeechTextProvider(value: SpeechCatalog | SpeechTextProvider): value is SpeechTextProvider {
  return 'getLine' in value;
}

function contextFromStore(store: RuntimeStore): RuntimeContext {
  const snapshot = store.getSnapshot();
  return {
    emotions: snapshot.emotions,
    relationship: snapshot.relationship,
    personality: snapshot.personality,
    counters: snapshot.counters
  };
}

function clampText(text: string, maxChars?: number): string {
  if (!maxChars || text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}
