import { describe, expect, it } from 'vitest';
import type { AssistantIntent } from '../../ai/llm/types';
import { meetingReplyEvents, mergeReplyPerformances } from './meetingVoice';

describe('meeting voice', () => {
  it('targets every reply segment at the speaking character', () => {
    const intent = {
      replies: [
        { speech: '先说。', emotion: 'happy', intensity: 0.7, shortAction: 'happy_small' },
        { speech: '再说。', emotion: 'curious', intensity: 0.4, shortAction: 'agree_soft' }
      ],
      speech: '先说。\n再说。',
      soulEvent: 'chat',
      emotion: 'curious',
      intensity: 0.4,
      memories: []
    } satisfies AssistantIntent;

    const events = meetingReplyEvents('meeting-message', 'designer', intent);

    expect(events.map(({ type }) => type)).toEqual([
      'reply-stream-start',
      'reply-stream-segment',
      'reply-stream-end'
    ]);
    expect(events.every((event) => event.characterId === 'designer')).toBe(true);
  });
});

describe('meeting reply merging', () => {
  it('把整轮合成一条消息，段与段之间保留换行', () => {
    expect(
      mergeReplyPerformances([
        { text: '先说。', emotion: 'happy', intensity: 0.7, shortAction: 'happy_small', estimatedDurationMs: 1 },
        { text: '再说。', emotion: 'curious', intensity: 0.4, shortAction: 'agree_soft', estimatedDurationMs: 2 }
      ])
    ).toBe('先说。\n再说。');
  });

  it('去掉每段两侧的空白与整段为空的那一段，只有一段时也不多出换行', () => {
    expect(
      mergeReplyPerformances([
        { text: '  就一句。  ', emotion: 'happy', intensity: 0.5, shortAction: 'agree_soft', estimatedDurationMs: 1 },
        { text: '   ', emotion: 'happy', intensity: 0.5, shortAction: 'agree_soft', estimatedDurationMs: 1 }
      ])
    ).toBe('就一句。');
  });
});
