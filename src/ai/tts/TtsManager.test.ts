import { describe, expect, it, vi } from 'vitest';
import { RuntimeStore } from '../../app/state/RuntimeStore';
import { TtsManager } from './TtsManager';
import type { PreparedSpeech, TtsPrepareOptions, TtsProvider, TtsSpeakOptions } from './types';

describe('TtsManager', () => {
  it('speaks streamed segments in order and completes with the final text', async () => {
    const provider = new RecordingTtsProvider();
    const store = new RuntimeStore();
    const turn = new TtsManager(provider, store).startTurn({ intent: 'conversation_reply' });

    turn.push('第一句。第二');
    turn.push('第一句。第二句。');
    await turn.finish('第一句。第二句。最后一点');

    expect(provider.spoken).toEqual(['第一句。', '第二句。', '最后一点']);
    expect(store.getSnapshot().speech).toEqual({
      intent: 'conversation_reply',
      text: '第一句。第二句。最后一点',
      speaking: false,
      bubbleVisible: false
    });
  });

  it('reports playback start only once when the provider starts the first segment', async () => {
    const provider = new RecordingTtsProvider();
    const onPlaybackStart = vi.fn();
    const turn = new TtsManager(provider, new RuntimeStore()).startTurn({ onPlaybackStart });

    turn.push('第一句。第二句。');
    await turn.finish('第一句。第二句。');

    expect(onPlaybackStart).toHaveBeenCalledOnce();
  });

  it('shows the display text only when audio playback actually starts', async () => {
    const provider = new DeferredTtsProvider();
    const store = new RuntimeStore();
    const turn = new TtsManager(provider, store).startTurn({ intent: 'conversation_reply' });

    const done = turn.finish('气泡文本。', 'translated speech');
    expect(store.getSnapshot().speech.speaking).toBe(false);

    provider.startPlayback();
    expect(store.getSnapshot().speech).toEqual({
      intent: 'conversation_reply',
      text: '气泡文本。',
      speaking: true,
      bubbleVisible: true
    });

    provider.finishPlayback();
    await done;
  });

  it('ends lip sync before trailing audio silence finishes', async () => {
    const provider = new DeferredTtsProvider();
    const store = new RuntimeStore();
    const turn = new TtsManager(provider, store).startTurn();

    const done = turn.finish('还有一秒静音。');
    provider.startPlayback();
    await vi.waitFor(() => expect(store.getSnapshot().speech.speaking).toBe(true));
    provider.endLipSync();

    expect(store.getSnapshot().speech.speaking).toBe(false);
    provider.finishPlayback();
    await done;
  });

  it('keeps the bubble visible after lip sync ends and clears it only when playback finishes', async () => {
    const provider = new DeferredTtsProvider();
    const store = new RuntimeStore();
    const turn = new TtsManager(provider, store).startTurn({ intent: 'conversation_reply' });

    const done = turn.finish('尾音还没放完。');
    provider.startPlayback();
    await vi.waitFor(() => expect(store.getSnapshot().speech.bubbleVisible).toBe(true));

    // Lip sync closes one second early; the bubble must still cover the tail.
    provider.endLipSync();
    expect(store.getSnapshot().speech).toEqual({
      intent: 'conversation_reply',
      text: '尾音还没放完。',
      speaking: false,
      bubbleVisible: true
    });

    provider.finishPlayback();
    await done;
    expect(store.getSnapshot().speech.bubbleVisible).toBe(false);
  });

  it('cancels queued speech when the turn is interrupted', async () => {
    const provider = new RecordingTtsProvider();
    const store = new RuntimeStore();
    const manager = new TtsManager(provider, store);
    const turn = manager.startTurn();

    turn.push('会被打断。后面的内容不会播放。');
    manager.cancel();
    await turn.done;

    expect(provider.cancelCount).toBeGreaterThan(0);
    expect(store.getSnapshot().speech.speaking).toBe(false);
  });

  it('can speak translated text while keeping the display text in state', async () => {
    const provider = new RecordingTtsProvider();
    const store = new RuntimeStore();
    const turn = new TtsManager(provider, store).startTurn({ intent: 'conversation_reply' });

    await turn.finish('今天也辛苦啦', '今日もお疲れさま。');

    expect(provider.spoken).toEqual(['今日もお疲れさま。']);
    expect(store.getSnapshot().speech).toEqual({
      intent: 'conversation_reply',
      text: '今天也辛苦啦',
      speaking: false,
      bubbleVisible: false
    });
  });

  it('renders the next line while the current one is still playing', async () => {
    const provider = new PreparingTtsProvider();
    const manager = new TtsManager(provider, new RuntimeStore());
    const turn = manager.startTurn({ intent: 'conversation_reply' });

    void turn.finish('第一句。第二句。');
    // The first line is rendered on demand, exactly as before the lookahead.
    expect(provider.prepared).toEqual(['第一句。']);

    provider.render('第一句。');
    await vi.waitFor(() => expect(provider.played).toEqual(['第一句。']));
    // Still speaking, and the second line is already rendered.
    expect(provider.prepared).toEqual(['第一句。', '第二句。']);

    provider.render('第二句。');
    provider.finishPlayback();
    await vi.waitFor(() => expect(provider.played).toEqual(['第一句。', '第二句。']));
    // Playing the lookahead must not render the line a second time.
    expect(provider.prepared).toEqual(['第一句。', '第二句。']);

    provider.finishPlayback();
    await turn.done;
  });

  it('falls back to synthesizing on demand when a render fails', async () => {
    const provider = new PreparingTtsProvider();
    const manager = new TtsManager(provider, new RuntimeStore());
    const turn = manager.startTurn({ intent: 'conversation_reply' });

    void turn.finish('第一句。第二句。');
    provider.render('第一句。');
    await vi.waitFor(() => expect(provider.played).toEqual(['第一句。']));

    provider.failRender('第二句。');
    provider.finishPlayback();
    await vi.waitFor(() => expect(provider.spoken).toEqual(['第二句。']));
    expect(provider.played).toEqual(['第一句。']);

    provider.finishPlayback();
    await turn.done;
  });

  it('aborts the render in flight when the turn is interrupted', async () => {
    const provider = new PreparingTtsProvider();
    const manager = new TtsManager(provider, new RuntimeStore());
    const turn = manager.startTurn({ intent: 'conversation_reply' });

    void turn.finish('第一句。第二句。');
    provider.render('第一句。');
    await vi.waitFor(() => expect(provider.played).toEqual(['第一句。']));
    expect(provider.prepared).toEqual(['第一句。', '第二句。']);

    manager.cancel();

    expect(provider.aborted).toEqual(['第二句。']);
    expect(provider.played).toEqual(['第一句。']);
    await turn.done;
  });

  it('ends lip sync on time while another line is only being rendered', async () => {
    const provider = new PreparingTtsProvider();
    const store = new RuntimeStore();
    const manager = new TtsManager(provider, store);
    // What the reply stream asks for while the last segment is speaking: a line
    // that is not in this turn's queue, so it must not delay the mouth closing.
    manager.prefetchSpeech('下一段回复。');
    const turn = manager.startTurn({ intent: 'conversation_reply' });

    void turn.finish('最后一句。');
    provider.render('最后一句。');
    await vi.waitFor(() => expect(store.getSnapshot().speech.speaking).toBe(true));

    provider.endLipSync();
    expect(store.getSnapshot().speech.speaking).toBe(false);

    provider.finishPlayback();
    await turn.done;
    // Both renders are in flight at the same time and neither waited for the other.
    expect(provider.prepared).toEqual(['下一段回复。', '最后一句。']);
    expect(store.getSnapshot().speech.bubbleVisible).toBe(false);
  });
});

class RecordingTtsProvider implements TtsProvider {
  readonly id = 'recording';
  readonly spoken: string[] = [];
  cancelCount = 0;

  isSupported(): boolean {
    return true;
  }

  async speak(text: string, _options?: TtsSpeakOptions): Promise<void> {
    _options?.onPlaybackStart?.();
    this.spoken.push(text);
  }

  cancel(): void {
    this.cancelCount += 1;
  }
}

class DeferredTtsProvider implements TtsProvider {
  readonly id = 'deferred';
  private options?: TtsSpeakOptions;
  private resolve?: () => void;

  isSupported(): boolean {
    return true;
  }

  speak(_text: string, options?: TtsSpeakOptions): Promise<void> {
    this.options = options;
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  startPlayback(): void {
    this.options?.onPlaybackStart?.();
  }

  endLipSync(): void {
    this.options?.onLipSyncEnd?.();
  }

  finishPlayback(): void {
    this.resolve?.();
  }

  cancel(): void {}
}

/**
 * A provider that splits rendering from playback, with both halves under the
 * test's control — the only way to observe that the next line is rendered while
 * the current one still occupies the voice.
 */
class PreparingTtsProvider implements TtsProvider {
  readonly id = 'preparing';
  readonly prepared: string[] = [];
  readonly played: string[] = [];
  readonly spoken: string[] = [];
  readonly aborted: string[] = [];
  private readonly renders = new Map<string, Deferred<PreparedSpeech>>();
  private readonly playback: Array<{ options: TtsSpeakOptions }> = [];
  private readonly playbackResolvers: Array<() => void> = [];

  isSupported(): boolean {
    return true;
  }

  prepare(text: string, options: TtsPrepareOptions = {}): Promise<PreparedSpeech> {
    this.prepared.push(text);
    const render = createDeferred<PreparedSpeech>();
    this.renders.set(text, render);
    const abort = () => {
      this.aborted.push(text);
      render.reject(new DOMException('Speech was aborted', 'AbortError'));
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    return render.promise;
  }

  play(prepared: PreparedSpeech, options: TtsSpeakOptions = {}): Promise<void> {
    this.played.push(new TextDecoder().decode(prepared.bytes));
    return this.beginPlayback(options);
  }

  speak(text: string, options: TtsSpeakOptions = {}): Promise<void> {
    this.spoken.push(text);
    return this.beginPlayback(options);
  }

  cancel(): void {}

  render(text: string): void {
    this.renders.get(text)?.resolve({ bytes: new TextEncoder().encode(text), mediaType: 'audio/mpeg' });
    this.renders.delete(text);
  }

  failRender(text: string): void {
    this.renders.get(text)?.reject(new Error(`render failed: ${text}`));
    this.renders.delete(text);
  }

  endLipSync(): void {
    this.playback[0]?.options.onLipSyncEnd?.();
  }

  finishPlayback(): void {
    this.playback.shift();
    this.playbackResolvers.shift()?.();
  }

  private beginPlayback(options: TtsSpeakOptions): Promise<void> {
    this.playback.push({ options });
    options.onPlaybackStart?.();
    return new Promise<void>((resolve) => this.playbackResolvers.push(resolve));
  }
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(cause: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}
