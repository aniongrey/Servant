import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SPEECH_BUBBLE_AFTER_SPEECH_MS,
  SPEECH_BUBBLE_CHARS_PER_SECOND,
  SPEECH_BUBBLE_FADE_MS,
  SpeechBubbleTimeline,
  getSpeechBubbleDurationMs,
  type SpeechBubbleState
} from './speechBubble';

function createTimeline(options: { holdMs?: number; fadeMs?: number } = {}) {
  const states: SpeechBubbleState[] = [];
  const timeline = new SpeechBubbleTimeline({
    onChange: (state) => states.push(state),
    ...options
  });
  return { states, timeline };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getSpeechBubbleDurationMs', () => {
  it('keeps a bubble for the longer of reading time and voice duration plus the hold', () => {
    expect(getSpeechBubbleDurationMs('123456789', 0)).toBe(5000);
    expect(getSpeechBubbleDurationMs('短', 7000)).toBe(12000);
    expect(SPEECH_BUBBLE_CHARS_PER_SECOND).toBe(3);
  });
});

describe('SpeechBubbleTimeline', () => {
  it('stays fully opaque through the hold and only fades once the hold expires', () => {
    const { states, timeline } = createTimeline();

    timeline.show('尾音还没放完。');
    expect(states.at(-1)).toEqual({ text: '尾音还没放完。', speaking: true });

    timeline.finish();
    vi.advanceTimersByTime(SPEECH_BUBBLE_AFTER_SPEECH_MS - 1);
    expect(states.at(-1)).toEqual({ text: '尾音还没放完。', speaking: true });

    vi.advanceTimersByTime(1);
    expect(states.at(-1)).toEqual({ text: '尾音还没放完。', speaking: false });

    vi.advanceTimersByTime(SPEECH_BUBBLE_FADE_MS);
    expect(states.at(-1)).toEqual({ text: '', speaking: false });
  });

  it('refreshes the text while the audio is still playing', () => {
    const { states, timeline } = createTimeline();

    timeline.show('你好');
    timeline.show('你好，今天');
    timeline.finish();
    vi.advanceTimersByTime(SPEECH_BUBBLE_AFTER_SPEECH_MS);

    expect(states.at(-1)).toEqual({ text: '你好，今天', speaking: false });
  });

  it('lets a real completion shorten the lost-end safety timeout', () => {
    const { states, timeline } = createTimeline();

    timeline.show('长文本也不该一直挂在屏幕上。');
    timeline.hideAfter(60_000);
    timeline.finish();
    vi.advanceTimersByTime(SPEECH_BUBBLE_AFTER_SPEECH_MS + SPEECH_BUBBLE_FADE_MS);

    expect(states.at(-1)).toEqual({ text: '', speaking: false });
  });

  it('hides immediately when the speech is cancelled', () => {
    const { states, timeline } = createTimeline();

    timeline.show('还没说完');
    timeline.hide();

    expect(states.at(-1)).toEqual({ text: '', speaking: false });
    vi.advanceTimersByTime(60_000);
    expect(states.at(-1)).toEqual({ text: '', speaking: false });
  });

  it('ignores a completion that arrives without any text', () => {
    const { states, timeline } = createTimeline();

    timeline.finish();
    vi.advanceTimersByTime(60_000);

    expect(states).toEqual([]);
  });
});
