import { describe, expect, it, vi } from 'vitest';
import { DesktopConversationSpeechStream } from './DesktopConversationSpeechStream';
import type { DesktopReplySegment } from '../../app/network/realtime/VoiceStreamProtocol';

describe('DesktopConversationSpeechStream', () => {
  it('replays a conversation as one cumulative streaming TTS turn', async () => {
    let onPlaybackStart: (() => void) | undefined;
    const turn = {
      push: vi.fn(),
      finish: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn(),
      done: Promise.resolve()
    };
    const speech = {
      startStreaming: vi.fn((options: { onPlaybackStart?: () => void }) => {
        onPlaybackStart = options.onPlaybackStart;
        return turn;
      }),
      cancel: vi.fn()
    };
    const onStatus = vi.fn();
    const stream = new DesktopConversationSpeechStream(speech, onStatus);

    stream.handle({ type: 'speech-start', id: 'turn-1', text: '你好', source: 'conversation' });
    expect(onStatus).not.toHaveBeenCalled();
    onPlaybackStart?.();
    stream.handle({ type: 'speech-delta', id: 'turn-1', text: '你好，今天', source: 'conversation' });
    stream.handle({ type: 'speech-end', id: 'turn-1', text: '你好，今天好吗？', source: 'conversation' });

    expect(speech.startStreaming).toHaveBeenCalledWith({
      intent: 'conversation_reply',
      onPlaybackStart: expect.any(Function)
    });
    expect(turn.push).toHaveBeenNthCalledWith(1, '你好');
    expect(turn.push).toHaveBeenNthCalledWith(2, '你好，今天');
    expect(turn.finish).toHaveBeenCalledWith('你好，今天好吗？', '你好，今天好吗？');
    expect(onStatus).toHaveBeenNthCalledWith(1, 'speech-playback-started', 'turn-1');
    await Promise.resolve();
    expect(onStatus).toHaveBeenNthCalledWith(2, 'speech-playback-completed', 'turn-1');
  });

  it('cancels the active desktop TTS turn from a websocket event', () => {
    const turn = {
      push: vi.fn(),
      finish: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn(),
      done: Promise.resolve()
    };
    const speech = { startStreaming: vi.fn(() => turn), cancel: vi.fn() };
    const onStatus = vi.fn();
    const stream = new DesktopConversationSpeechStream(speech, onStatus);

    stream.handle({ type: 'speech-start', id: 'turn-1', text: '你好', source: 'conversation' });
    stream.handle({ type: 'speech-cancel', id: 'turn-1', source: 'conversation' });

    expect(turn.cancel).toHaveBeenCalledOnce();
    expect(speech.cancel).toHaveBeenCalled();
    expect(onStatus).toHaveBeenLastCalledWith('speech-playback-completed', 'turn-1');
  });

  it('defers translated playback until the final spoken text arrives', () => {
    const turn = {
      push: vi.fn(),
      finish: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn(),
      done: Promise.resolve()
    };
    const stream = new DesktopConversationSpeechStream({
      startStreaming: vi.fn(() => turn),
      cancel: vi.fn()
    });

    stream.handle({
      type: 'speech-start',
      id: 'translated',
      text: '你好',
      playback: 'final',
      source: 'conversation'
    });
    stream.handle({ type: 'speech-delta', id: 'translated', text: '你好呀。', source: 'conversation' });
    stream.handle({
      type: 'speech-end',
      id: 'translated',
      text: '你好呀。',
      spokenText: 'こんにちは。',
      source: 'conversation'
    });

    expect(turn.push).not.toHaveBeenCalled();
    expect(turn.finish).toHaveBeenCalledWith('你好呀。', 'こんにちは。');
  });

  it('does not replay reminder lifecycle speech', () => {
    const speech = { startStreaming: vi.fn(), cancel: vi.fn() };
    const stream = new DesktopConversationSpeechStream(speech);

    stream.handle({ type: 'speech-start', id: 'reminder-1', text: '休息一下', source: 'reminder' });

    expect(speech.startStreaming).not.toHaveBeenCalled();
  });

  it('plays one short action per reply segment and advances only after speech ends', async () => {
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    const firstDone = new Promise<void>((resolve) => (finishFirst = resolve));
    const secondDone = new Promise<void>((resolve) => (finishSecond = resolve));
    const turns = [
      { push: vi.fn(), finish: vi.fn(() => firstDone), cancel: vi.fn(), done: firstDone },
      { push: vi.fn(), finish: vi.fn(() => secondDone), cancel: vi.fn(), done: secondDone }
    ];
    const speech = { startStreaming: vi.fn(() => turns.shift()!), cancel: vi.fn() };
    const actions = { play: vi.fn().mockResolvedValue(undefined), returnToIdle: vi.fn() };
    const onStatus = vi.fn();
    const stream = new DesktopConversationSpeechStream(speech, onStatus, actions);

    stream.handle({
      type: 'reply-sequence',
      id: 'multi',
      source: 'conversation',
      segments: [
        {
          text: '第一段。',
          spokenText: '第一段。',
          emotion: 'happy',
          intensity: 0.6,
          shortAction: 'stunned'
        },
        { text: '第二段。', spokenText: '第二段。', emotion: 'curious', intensity: 0.5, shortAction: 'agree' }
      ]
    });
    await Promise.resolve();
    expect(actions.play).toHaveBeenCalledTimes(1);
    expect(actions.play.mock.calls[0][0]).toBe('stunned');
    expect(speech.startStreaming).toHaveBeenCalledTimes(1);

    finishFirst();
    await Promise.resolve();
    await Promise.resolve();
    expect(actions.play).toHaveBeenCalledTimes(2);
    expect(actions.play.mock.calls[1][0]).toBe('agree');
    expect(speech.startStreaming).toHaveBeenCalledTimes(2);
    expect(actions.returnToIdle).not.toHaveBeenCalled();

    finishSecond();
    await Promise.resolve();
    await Promise.resolve();
    expect(actions.returnToIdle).toHaveBeenCalledOnce();
    expect(onStatus).toHaveBeenLastCalledWith('speech-playback-completed', 'multi');
  });

  it('starts the first action and speech before the streamed reply is closed', async () => {
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    const firstDone = new Promise<void>((resolve) => (finishFirst = resolve));
    const secondDone = new Promise<void>((resolve) => (finishSecond = resolve));
    const turns = [
      { push: vi.fn(), finish: vi.fn(() => firstDone), cancel: vi.fn(), done: firstDone },
      { push: vi.fn(), finish: vi.fn(() => secondDone), cancel: vi.fn(), done: secondDone }
    ];
    const speech = { startStreaming: vi.fn(() => turns.shift()!), cancel: vi.fn() };
    const actions = { play: vi.fn().mockResolvedValue(undefined), returnToIdle: vi.fn() };
    const stream = new DesktopConversationSpeechStream(speech, vi.fn(), actions);

    stream.handle({
      type: 'reply-stream-start',
      id: 'streamed',
      source: 'conversation',
      segment: {
        text: '先说。',
        spokenText: '先说。',
        emotion: 'happy',
        intensity: 0.6,
        shortAction: 'stunned'
      }
    });
    expect(actions.play).toHaveBeenCalledWith('stunned', expect.any(AbortSignal));
    expect(speech.startStreaming).toHaveBeenCalledTimes(1);

    stream.handle({
      type: 'reply-stream-segment',
      id: 'streamed',
      index: 1,
      source: 'conversation',
      segment: {
        text: '后说。',
        spokenText: '后说。',
        emotion: 'curious',
        intensity: 0.5,
        shortAction: 'agree'
      }
    });
    stream.handle({
      type: 'reply-stream-end',
      id: 'streamed',
      segmentCount: 2,
      source: 'conversation'
    });
    expect(speech.startStreaming).toHaveBeenCalledTimes(1);

    finishFirst();
    await Promise.resolve();
    await Promise.resolve();
    expect(speech.startStreaming).toHaveBeenCalledTimes(2);
    finishSecond();
    await Promise.resolve();
    await Promise.resolve();
    expect(actions.returnToIdle).toHaveBeenCalledOnce();
  });

  it('plays later segments without a desktop typing delay', async () => {
    vi.useFakeTimers();
    try {
      let finishFirst!: () => void;
      const firstDone = new Promise<void>((resolve) => (finishFirst = resolve));
      const turns = [
        { push: vi.fn(), finish: vi.fn(() => firstDone), cancel: vi.fn(), done: firstDone },
        {
          push: vi.fn(),
          finish: vi.fn().mockResolvedValue(undefined),
          cancel: vi.fn(),
          done: Promise.resolve()
        }
      ];
      const speech = { startStreaming: vi.fn(() => turns.shift()!), cancel: vi.fn() };
      const actions = { play: vi.fn().mockResolvedValue(undefined), returnToIdle: vi.fn() };
      const stream = new DesktopConversationSpeechStream(speech, vi.fn(), actions, vi.fn());

      stream.handle({
        type: 'reply-sequence',
        id: 'paced',
        source: 'conversation',
        segments: [
          {
            text: '第一段。',
            spokenText: '第一段。',
            emotion: 'happy',
            intensity: 0.7,
            shortAction: 'stunned'
          },
          {
            text: '第二段。',
            spokenText: '第二段。',
            emotion: 'curious',
            intensity: 0.5,
            shortAction: 'agree'
          }
        ]
      });
      finishFirst();
      await Promise.resolve();
      await Promise.resolve();

      expect(actions.play).toHaveBeenCalledTimes(2);
      expect(actions.returnToIdle).toHaveBeenCalledOnce();
      expect(actions.play).toHaveBeenLastCalledWith('agree', expect.any(AbortSignal));
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the next answer segment while the current one is still speaking', async () => {
    let finishFirst!: () => void;
    const firstDone = new Promise<void>((resolve) => (finishFirst = resolve));
    const turns = [
      { push: vi.fn(), finish: vi.fn(() => firstDone), cancel: vi.fn(), done: firstDone },
      {
        push: vi.fn(),
        finish: vi.fn().mockResolvedValue(undefined),
        cancel: vi.fn(),
        done: Promise.resolve()
      }
    ];
    const playbackStarts: Array<() => void> = [];
    const speech = {
      startStreaming: vi.fn((options: { onPlaybackStart?: () => void }) => {
        if (options.onPlaybackStart) playbackStarts.push(options.onPlaybackStart);
        return turns.shift()!;
      }),
      cancel: vi.fn(),
      prefetchSpeech: vi.fn()
    };
    const stream = new DesktopConversationSpeechStream(speech, vi.fn());

    stream.handle({
      type: 'reply-sequence',
      id: 'ahead',
      source: 'conversation',
      segments: [replySegment('先说。'), replySegment('后说。', '後で言う。')]
    });
    await Promise.resolve();

    // Nothing is rendered ahead of the first segment: its own audio is the head start.
    expect(speech.prefetchSpeech).not.toHaveBeenCalled();

    playbackStarts[0]();
    // The next segment is rendered for the *spoken* text, mid-playback.
    expect(speech.prefetchSpeech).toHaveBeenCalledWith('後で言う。');

    finishFirst();
    await vi.waitFor(() => expect(playbackStarts).toHaveLength(2));
    speech.prefetchSpeech.mockClear();
    playbackStarts[1]();
    expect(speech.prefetchSpeech).not.toHaveBeenCalled();
  });
});

function replySegment(text: string, spokenText = text): DesktopReplySegment {
  return { text, spokenText, emotion: 'happy', intensity: 0.5, shortAction: 'stunned' };
}
