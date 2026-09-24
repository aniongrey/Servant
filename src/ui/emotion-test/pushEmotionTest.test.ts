import { expect, it, vi } from 'vitest';
import { pushEmotionTest } from './pushEmotionTest';
import { parseVoiceStreamEvent } from '../../app/network/realtime/VoiceStreamProtocol';

it('publishes valid LLM reply events and stops streaming after interruption', async () => {
  vi.useFakeTimers();
  try {
    const segments = ['happy_small', 'shrug_small'].map((shortAction) => ({
      shortAction,
      emotion: 'neutral' as const,
      intensity: 0.5,
      text: '测试台词',
      spokenText: '测试台词'
    }));
    const send = vi.fn();
    await pushEmotionTest(send, 'single', segments, false, 0, new AbortController().signal);
    expect(parseVoiceStreamEvent(send.mock.calls[0][0])).toMatchObject({ type: 'reply-sequence', segments });
    send.mockClear();
    const completed = pushEmotionTest(send, 'stream', segments, true, 1000, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1000);
    await completed;
    expect(send.mock.calls.map(([event]) => event.type)).toEqual([
      'reply-stream-start',
      'reply-stream-segment',
      'reply-stream-end'
    ]);
    expect(send.mock.calls.every(([event]) => Boolean(parseVoiceStreamEvent(event)))).toBe(true);
    send.mockClear();
    const controller = new AbortController();
    const interrupted = pushEmotionTest(send, 'cancel', segments, true, 1000, controller.signal);
    const result = expect(interrupted).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await result;
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
