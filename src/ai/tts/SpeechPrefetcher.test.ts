import { describe, expect, it } from 'vitest';
import { SpeechPrefetcher } from './SpeechPrefetcher';
import type { PreparedSpeech, TtsProvider, TtsPrepareOptions, TtsSpeakOptions } from './types';

describe('SpeechPrefetcher', () => {
  it('does nothing when the provider cannot render separately', () => {
    const provider = new SpeakOnlyProvider();
    const prefetcher = new SpeechPrefetcher(provider);

    prefetcher.request('第一句。');

    expect(provider.spoken).toEqual([]);
    expect(prefetcher.take('第一句。')).toBeUndefined();
  });

  it('hands the rendered audio over once, keyed by spoken text', async () => {
    const provider = new PrepareProvider();
    const prefetcher = new SpeechPrefetcher(provider);

    prefetcher.request('第一句。');
    expect(provider.prepared).toEqual(['第一句。']);

    provider.resolve('第一句。');
    await expect(prefetcher.take('第一句。')).resolves.toEqual(provider.audioFor('第一句。'));
    expect(prefetcher.take('第一句。')).toBeUndefined();
  });

  it('ignores repeat requests for the same line', () => {
    const provider = new PrepareProvider();
    const prefetcher = new SpeechPrefetcher(provider);

    prefetcher.request('第一句。');
    prefetcher.request('第一句。');

    expect(provider.prepared).toEqual(['第一句。']);
  });

  it('drops the oldest render when more lines are queued than the slot count', () => {
    const provider = new PrepareProvider();
    const prefetcher = new SpeechPrefetcher(provider, 2);

    prefetcher.request('第一句。');
    prefetcher.request('第二句。');
    prefetcher.request('第三句。');

    expect(provider.prepared).toEqual(['第一句。', '第二句。', '第三句。']);
    expect(provider.aborted).toEqual(['第一句。']);
    expect(prefetcher.take('第一句。')).toBeUndefined();
    expect(prefetcher.take('第三句。')).toBeDefined();
  });

  it('resolves to undefined when rendering fails so the caller can retry on demand', async () => {
    const provider = new PrepareProvider();
    const prefetcher = new SpeechPrefetcher(provider);

    prefetcher.request('第一句。');
    provider.fail('第一句。');

    await expect(prefetcher.take('第一句。')).resolves.toBeUndefined();
  });

  it('aborts everything in flight on cancel without touching the provider', () => {
    const provider = new PrepareProvider();
    const prefetcher = new SpeechPrefetcher(provider);

    prefetcher.request('第一句。');
    prefetcher.cancel();

    expect(provider.aborted).toEqual(['第一句。']);
    expect(provider.cancelCount).toBe(0);
    expect(prefetcher.take('第一句。')).toBeUndefined();
  });

  it('aborts a render when the caller signal goes away', () => {
    const provider = new PrepareProvider();
    const prefetcher = new SpeechPrefetcher(provider);
    const controller = new AbortController();

    prefetcher.request('第一句。', { signal: controller.signal });
    controller.abort();

    expect(provider.aborted).toEqual(['第一句。']);
  });
});

class PrepareProvider implements TtsProvider {
  readonly id = 'prepare';
  readonly prepared: string[] = [];
  readonly aborted: string[] = [];
  cancelCount = 0;
  private readonly pending = new Map<string, Deferred>();

  isSupported(): boolean {
    return true;
  }

  speak(_text: string, _options?: TtsSpeakOptions): Promise<void> {
    return Promise.resolve();
  }

  prepare(text: string, options: TtsPrepareOptions = {}): Promise<PreparedSpeech> {
    this.prepared.push(text);
    const deferred = createDeferred();
    this.pending.set(text, deferred);
    options.signal?.addEventListener(
      'abort',
      () => {
        this.aborted.push(text);
        deferred.reject(new DOMException('Speech was aborted', 'AbortError'));
      },
      { once: true }
    );
    if (options.signal?.aborted) this.aborted.push(text);
    return deferred.promise;
  }

  play(_prepared: PreparedSpeech, _options?: TtsSpeakOptions): Promise<void> {
    return Promise.resolve();
  }

  cancel(): void {
    this.cancelCount += 1;
  }

  audioFor(text: string): PreparedSpeech {
    return { bytes: new TextEncoder().encode(text), mediaType: 'audio/mpeg' };
  }

  resolve(text: string): void {
    this.pending.get(text)?.resolve(this.audioFor(text));
    this.pending.delete(text);
  }

  fail(text: string): void {
    this.pending.get(text)?.reject(new Error(`render failed: ${text}`));
    this.pending.delete(text);
  }
}

class SpeakOnlyProvider implements TtsProvider {
  readonly id = 'speak-only';
  readonly spoken: string[] = [];

  isSupported(): boolean {
    return true;
  }

  speak(text: string, _options?: TtsSpeakOptions): Promise<void> {
    this.spoken.push(text);
    return Promise.resolve();
  }

  cancel(): void {}
}

interface Deferred {
  readonly promise: Promise<PreparedSpeech>;
  resolve(value: PreparedSpeech): void;
  reject(cause: unknown): void;
}

function createDeferred(): Deferred {
  let resolve!: (value: PreparedSpeech) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<PreparedSpeech>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}
