import { describe, expect, it } from 'vitest';
import type { VoiceStreamEvent } from '../../app/network/realtime/VoiceStreamProtocol';
import { segmentFromVoiceEvent } from './stageSegment';

const segment = { text: '第一段。', spokenText: '第一段。', emotion: 'happy' as const, intensity: 0.7, shortAction: 'happy_small' };

describe('stage segment extraction', () => {
  it('reads the first segment out of a whole-sequence event', () => {
    const event: VoiceStreamEvent = {
      type: 'reply-sequence',
      id: 'meeting-abc',
      segments: [segment, { ...segment, text: '第二段。' }],
      source: 'conversation',
      characterId: 'mio'
    };
    expect(segmentFromVoiceEvent(event)).toMatchObject({
      messageId: 'abc',
      characterId: 'mio',
      text: '第一段。',
      emotion: 'happy',
      shortAction: 'happy_small'
    });
  });

  it('reads start and follow-up segment events', () => {
    const start: VoiceStreamEvent = {
      type: 'reply-stream-start',
      id: 'meeting-abc',
      segment,
      source: 'conversation',
      characterId: 'mio'
    };
    const followUp: VoiceStreamEvent = {
      type: 'reply-stream-segment',
      id: 'meeting-abc',
      index: 1,
      segment: { ...segment, text: '第二段。', emotion: 'sad', shortAction: 'sigh_soft' },
      source: 'conversation',
      characterId: 'mio'
    };
    expect(segmentFromVoiceEvent(start)?.text).toBe('第一段。');
    // 后续段必须真的覆盖前一段，否则对白框会永远停在第一句。
    expect(segmentFromVoiceEvent(followUp)).toMatchObject({ text: '第二段。', emotion: 'sad', shortAction: 'sigh_soft' });
  });

  it('ignores sentence-level speech events so they cannot clobber the dialogue box', () => {
    // `speech-start` / `speech-delta` 走的是单句通道，没有 emotion / shortAction，
    // 让它们进来会把正在演的那一句顶掉。
    const events: VoiceStreamEvent[] = [
      { type: 'speech-start', id: 'meeting-abc', text: '你好', source: 'conversation' },
      { type: 'speech-delta', id: 'meeting-abc', text: '你好呀', source: 'conversation' },
      { type: 'speech-end', id: 'meeting-abc', source: 'conversation' },
      { type: 'speech-cancel', id: 'meeting-abc', source: 'conversation' },
      { type: 'reply-stream-end', id: 'meeting-abc', segmentCount: 2, source: 'conversation' }
    ];
    for (const event of events) expect(segmentFromVoiceEvent(event)).toBeNull();
  });

  it('strips only the meeting prefix, leaving the message id intact', () => {
    const event: VoiceStreamEvent = {
      type: 'reply-stream-start',
      id: 'meeting-9f1c-4d2a',
      segment,
      source: 'conversation',
      characterId: 'mio'
    };
    expect(segmentFromVoiceEvent(event)?.messageId).toBe('9f1c-4d2a');
  });
});
