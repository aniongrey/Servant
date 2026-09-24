import { describe, expect, it } from 'vitest';
import type { ActivityLogEvent } from '../../app/logging/ActivityLog';
import { groupChatEvents, jsonByteLength } from './LogsPanel';

describe('groupChatEvents', () => {
  it('groups start and completed events by user message id', () => {
    const events: ActivityLogEvent[] = [
      {
        id: 'log-complete',
        at: 2,
        day: '2026-09-19',
        channel: 'chat',
        status: 'success',
        message: '聊天轮次完成',
        turnId: 'turn-1',
        details: {
          userMessage: { id: 'message-1', text: '你好' },
          reply: {
            speech: '你好呀',
            emotion: 'happy',
            replies: [{ speech: '你好呀', shortAction: 'agree_soft', custom: true }]
          },
          replyContext: { history: [{ text: '你好' }] }
        }
      },
      {
        id: 'log-start',
        at: 1,
        day: '2026-09-19',
        channel: 'chat',
        status: 'start',
        message: '聊天轮次开始',
        turnId: 'turn-1',
        details: { userMessage: { id: 'message-1', text: '你好' } }
      }
    ];

    expect(groupChatEvents(events)).toMatchObject([
      {
        messageId: 'message-1',
        legacy: false,
        events: [{ id: 'log-complete' }, { id: 'log-start' }],
        reply: { replies: [{ speech: '你好呀', shortAction: 'agree_soft', custom: true }] },
        replyContext: { history: [{ text: '你好' }] }
      }
    ]);
  });

  it('counts reply context as UTF-8 JSON bytes', () => {
    expect(jsonByteLength({ text: '你好' })).toBe(17);
  });

  it('marks old events without a user message as legacy turn groups', () => {
    const events: ActivityLogEvent[] = [
      {
        id: 'old-log',
        at: 1,
        day: '2026-09-19',
        channel: 'chat',
        status: 'success',
        message: '聊天轮次完成',
        turnId: 'turn-old',
        details: {}
      }
    ];

    expect(groupChatEvents(events)[0]).toMatchObject({ messageId: 'turn-old', legacy: true });
  });
});
