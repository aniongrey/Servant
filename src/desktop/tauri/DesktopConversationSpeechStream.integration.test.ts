import { describe, expect, it, vi } from 'vitest';
import { RuntimeStore } from '../../app/state/RuntimeStore';
import { SpeechController } from '../../ai/tts/SpeechController';
import { TtsManager } from '../../ai/tts/TtsManager';
import type { PreparedSpeech, TtsPrepareOptions, TtsProvider, TtsSpeakOptions } from '../../ai/tts/types';
import type { DesktopReplySegment } from '../../app/network/realtime/VoiceStreamProtocol';
import { DesktopConversationSpeechStream } from './DesktopConversationSpeechStream';

/**
 * The acceptance test for the reply prefetch: real reply sequencer, real
 * `SpeechController`, real `TtsManager`, real `SpeechPrefetcher` — only the voice
 * itself is fake. It pins down what the feature is for: the second reply segment
 * is rendered while the first one is still speaking, and speaking it does not
 * send a second synthesis request.
 */
describe('desktop reply prefetch', () => {
  it('renders the second segment during the first one and plays it without re-rendering', async () => {
    const provider = new ControlledTtsProvider();
    const store = new RuntimeStore();
    const speech = new SpeechController({}, store, 0, new TtsManager(provider, store));
    const statuses: string[] = [];
    const stream = new DesktopConversationSpeechStream(speech, (type, id) => statuses.push(`${type}:${id}`));

    stream.handle({
      type: 'reply-sequence',
      id: 'turn-1',
      source: 'conversation',
      segments: [replySegment('先说。'), replySegment('后说。', '後で言う。')]
    });

    // Segment one is rendered on demand — the first line has nothing to wait for.
    expect(provider.prepared).toEqual(['先说。']);

    provider.render('先说。');
    await vi.waitFor(() => expect(provider.spoken).toEqual(['先说。']));
    // Still speaking, and segment two is already rendered — this is the whole point.
    expect(provider.prepared).toEqual(['先说。', '後で言う。']);

    provider.render('後で言う。');
    provider.finishSpeaking();
    await vi.waitFor(() => expect(provider.spoken).toEqual(['先说。', '後で言う。']));
    expect(provider.prepared).toEqual(['先说。', '後で言う。']);

    provider.finishSpeaking();
    await vi.waitFor(() => expect(statuses).toContain('speech-playback-completed:turn-1'));
    expect(provider.spoken).toEqual(['先说。', '後で言う。']);
  });

  it('aborts a render in flight when the reply stream is cancelled', async () => {
    const provider = new ControlledTtsProvider();
    const store = new RuntimeStore();
    const speech = new SpeechController({}, store, 0, new TtsManager(provider, store));
    const stream = new DesktopConversationSpeechStream(speech, vi.fn());

    stream.handle({
      type: 'reply-sequence',
      id: 'turn-2',
      source: 'conversation',
      segments: [replySegment('先说。'), replySegment('后说。')]
    });
    provider.render('先说。');
    await vi.waitFor(() => expect(provider.prepared).toEqual(['先说。', '后说。']));

    stream.handle({ type: 'speech-cancel', id: 'turn-2', source: 'conversation' });

    expect(provider.aborted).toEqual(['后说。']);
    expect(provider.spoken).toEqual(['先说。']);
  });
});

function replySegment(text: string, spokenText = text): DesktopReplySegment {
  return { text, spokenText, emotion: 'happy', intensity: 0.5, shortAction: 'stunned' };
}

/** A voice whose rendering and playback each wait for the test to let them go. */
class ControlledTtsProvider implements TtsProvider {
  readonly id = 'controlled';
  readonly prepared: string[] = [];
  readonly spoken: string[] = [];
  readonly aborted: string[] = [];
  private readonly renders = new Map<string, Deferred<PreparedSpeech>>();
  private readonly playbackResolvers: Array<() => void> = [];

  isSupported(): boolean {
    return true;
  }

  prepare(text: string, options: TtsPrepareOptions = {}): Promise<PreparedSpeech> {
    this.prepared.push(text);
    const render = createDeferred<PreparedSpeech>();
    this.renders.set(text, render);
    options.signal?.addEventListener(
      'abort',
      () => {
        this.aborted.push(text);
        render.reject(new DOMException('Speech was aborted', 'AbortError'));
      },
      { once: true }
    );
    return render.promise;
  }

  play(prepared: PreparedSpeech, options: TtsSpeakOptions = {}): Promise<void> {
    this.spoken.push(new TextDecoder().decode(prepared.bytes));
    options.onPlaybackStart?.();
    return new Promise<void>((resolve) => this.playbackResolvers.push(resolve));
  }

  speak(text: string, options: TtsSpeakOptions = {}): Promise<void> {
    this.spoken.push(text);
    options.onPlaybackStart?.();
    return new Promise<void>((resolve) => this.playbackResolvers.push(resolve));
  }

  cancel(): void {}

  render(text: string): void {
    this.renders.get(text)?.resolve({ bytes: new TextEncoder().encode(text), mediaType: 'audio/mpeg' });
    this.renders.delete(text);
  }

  finishSpeaking(): void {
    this.playbackResolvers.shift()?.();
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
