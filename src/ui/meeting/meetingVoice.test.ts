import { describe, expect, it } from 'vitest';
import type { AssistantIntent } from '../../ai/llm/types';
import { meetingReplyEvents } from './meetingVoice';

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
