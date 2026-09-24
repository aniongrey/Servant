import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRemoteSpeechTracker } from './useRemoteSpeechBubble';
import { SPEECH_BUBBLE_AFTER_SPEECH_MS, SPEECH_BUBBLE_FADE_MS } from './speechBubble';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createRemoteSpeechTracker', () => {
  it('keeps the bubble readable after desktop playback completes, then fades it out', () => {
    const states: Array<{ text: string; speaking: boolean }> = [];
    const tracker = createRemoteSpeechTracker((state) => states.push(state));

    tracker.onEvent({ type: 'speech-start', id: 'turn-1', text: '你好', source: 'conversation' });
    tracker.onEvent({ type: 'speech-end', id: 'turn-1', text: '你好呀。', source: 'conversation' });
    expect(states.at(-1)).toEqual({ text: '你好呀。', speaking: true });

    tracker.onEvent({ type: 'speech-playback-completed', id: 'turn-1', source: 'conversation' });
    expect(states.at(-1)).toEqual({ text: '你好呀。', speaking: true });

    vi.advanceTimersByTime(SPEECH_BUBBLE_AFTER_SPEECH_MS);
    expect(states.at(-1)).toEqual({ text: '你好呀。', speaking: false });

    vi.advanceTimersByTime(SPEECH_BUBBLE_FADE_MS);
    expect(states.at(-1)).toEqual({ text: '', speaking: false });
    tracker.dispose();
  });

  it('hides the bubble as a last resort when no playback receipt ever arrives', () => {
    const states: Array<{ text: string; speaking: boolean }> = [];
    const tracker = createRemoteSpeechTracker((state) => states.push(state));

    tracker.onEvent({ type: 'speech-start', id: 'turn-1', text: '提醒你喝水。', source: 'reminder' });
    tracker.onEvent({ type: 'speech-end', id: 'turn-1', text: '提醒你喝水。', source: 'reminder' });
    vi.advanceTimersByTime(60_000);

    expect(states.at(-1)).toEqual({ text: '', speaking: false });
    tracker.dispose();
  });

  it('hides the active bubble immediately when chat sends a cancel event', () => {
    const states: Array<{ text: string; speaking: boolean }> = [];
    const tracker = createRemoteSpeechTracker((state) => states.push(state));
    tracker.onEvent({ type: 'speech-start', id: 'turn-1', text: '还没说完', source: 'conversation' });
    tracker.onEvent({ type: 'speech-cancel', id: 'turn-1', source: 'conversation' });

    expect(states.at(-1)).toEqual({ text: '', speaking: false });
    tracker.dispose();
  });

  it('ignores events from another utterance', () => {
    const states: Array<{ text: string; speaking: boolean }> = [];
    const tracker = createRemoteSpeechTracker((state) => states.push(state));
    tracker.onEvent({ type: 'speech-start', id: 'turn-1', text: '第一句', source: 'conversation' });
    tracker.onEvent({ type: 'speech-delta', id: 'turn-2', text: '别人的话', source: 'conversation' });
    tracker.onEvent({ type: 'speech-playback-completed', id: 'turn-2', source: 'conversation' });

    expect(states.at(-1)).toEqual({ text: '第一句', speaking: true });
    tracker.dispose();
  });
});
