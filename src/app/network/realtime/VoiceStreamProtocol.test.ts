import { describe, expect, it } from 'vitest';
import { parseVoiceStreamEvent, validateVoiceStreamEvent } from './VoiceStreamProtocol';

describe('voice stream protocol', () => {
  it('validates the reply stream lifecycle', () => {
    expect(
      validateVoiceStreamEvent({
        type: 'reply-stream-start',
        id: 'stream-1',
        source: 'conversation',
        segment: {
          text: '第一段',
          spokenText: '第一段',
          emotion: 'happy',
          intensity: 0.7,
          shortAction: 'stunned'
        }
      })
    ).toEqual({
      type: 'reply-stream-start',
      id: 'stream-1',
      source: 'conversation',
      segment: {
        text: '第一段',
        spokenText: '第一段',
        emotion: 'happy',
        intensity: 0.7,
        shortAction: 'stunned'
      }
    });
    expect(
      validateVoiceStreamEvent({
        type: 'reply-stream-segment',
        id: 'stream-1',
        index: 1,
        source: 'conversation',
        segment: {
          text: '第二段',
          spokenText: '第二段',
          emotion: 'curious',
          intensity: 0.5,
          shortAction: 'agree'
        }
      })
    ).toMatchObject({ type: 'reply-stream-segment', index: 1 });
    expect(
      validateVoiceStreamEvent({
        type: 'reply-stream-end',
        id: 'stream-1',
        segmentCount: 2,
        source: 'conversation'
      })
    ).toEqual({ type: 'reply-stream-end', id: 'stream-1', segmentCount: 2, source: 'conversation' });
  });

  it('validates the speech lifecycle including reminder sources', () => {
    expect(validateVoiceStreamEvent({ type: 'speech-start', id: '1', text: '你好' })).toEqual({
      type: 'speech-start',
      id: '1',
      text: '你好'
    });
    expect(
      validateVoiceStreamEvent({
        type: 'speech-start',
        id: 'reminder-1',
        text: '到点提醒',
        source: 'reminder'
      })
    ).toEqual({ type: 'speech-start', id: 'reminder-1', text: '到点提醒', source: 'reminder' });
    expect(
      validateVoiceStreamEvent({
        type: 'speech-end',
        id: '1',
        text: '你好呀。',
        spokenText: 'こんにちは。',
        source: 'conversation'
      })
    ).toEqual({
      type: 'speech-end',
      id: '1',
      text: '你好呀。',
      spokenText: 'こんにちは。',
      source: 'conversation'
    });
    expect(parseVoiceStreamEvent({ type: 'speech-cancel', id: '1', source: 'conversation' })).toEqual({
      type: 'speech-cancel',
      id: '1',
      source: 'conversation'
    });
    expect(
      validateVoiceStreamEvent({ type: 'speech-playback-started', id: '1', source: 'conversation' })
    ).toEqual({ type: 'speech-playback-started', id: '1', source: 'conversation' });
  });

  it('rejects malformed events', () => {
    expect(
      parseVoiceStreamEvent({ type: 'reply-sequence', id: '1', source: 'conversation', segments: [] })
    ).toBeUndefined();
    expect(parseVoiceStreamEvent({ type: 'speech-start', id: '1' })).toBeUndefined();
    expect(
      parseVoiceStreamEvent({
        type: 'reply-stream-segment',
        id: 'stream-1',
        index: 0,
        source: 'conversation',
        segment: { text: 'x', spokenText: 'x', emotion: 'neutral', intensity: 0.5, shortAction: 'x' }
      })
    ).toBeUndefined();
    expect(
      parseVoiceStreamEvent({ type: 'speech-playback-started', id: '1', source: 'reminder' })
    ).toBeUndefined();
    expect(parseVoiceStreamEvent({ type: 'unknown' })).toBeUndefined();
  });
});
