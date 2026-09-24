import { describe, expect, it } from 'vitest';
import { parseChatStreamEvent, validateChatStreamEvent } from './ChatStreamProtocol';

const assistantMessage = {
  id: 'msg-2',
  role: 'assistant',
  text: '第一段回复。',
  createdAt: 10
};

describe('chat stream protocol', () => {
  it('validates the turn lifecycle events', () => {
    expect(
      validateChatStreamEvent({
        type: 'turn-start',
        turnId: 'turn-1',
        userMessage: { id: 'msg-1', role: 'user', text: '你好', createdAt: 1 }
      })
    ).toMatchObject({ type: 'turn-start', userMessage: { text: '你好' } });
    expect(validateChatStreamEvent({ type: 'turn-phase', turnId: 'turn-1', searching: true })).toEqual({
      type: 'turn-phase',
      turnId: 'turn-1',
      searching: true
    });
    expect(
      validateChatStreamEvent({
        type: 'turn-segment',
        turnId: 'turn-1',
        index: 0,
        message: assistantMessage,
        emotion: 'happy',
        intensity: 0.5,
        shortAction: 'agree'
      })
    ).toEqual({
      type: 'turn-segment',
      turnId: 'turn-1',
      index: 0,
      message: assistantMessage,
      emotion: 'happy',
      intensity: 0.5,
      shortAction: 'agree'
    });
    expect(
      validateChatStreamEvent({
        type: 'turn-end',
        turnId: 'turn-1',
        segmentCount: 1,
        meta: { soulEvent: 'chat', searching: false }
      })
    ).toMatchObject({ type: 'turn-end', segmentCount: 1, meta: { soulEvent: 'chat' } });
    expect(validateChatStreamEvent({ type: 'turn-end', turnId: 'turn-1', segmentCount: 0 })).toEqual({
      type: 'turn-end',
      turnId: 'turn-1',
      segmentCount: 0
    });
    expect(validateChatStreamEvent({ type: 'turn-error', turnId: 'turn-1', message: '失败' })).toEqual({
      type: 'turn-error',
      turnId: 'turn-1',
      message: '失败'
    });
    expect(validateChatStreamEvent({ type: 'turn-cancelled', turnId: 'turn-1' })).toEqual({
      type: 'turn-cancelled',
      turnId: 'turn-1'
    });
  });

  it('accepts web-search messages with sources', () => {
    expect(
      validateChatStreamEvent({
        type: 'turn-segment',
        turnId: 'turn-1',
        index: 1,
        message: {
          ...assistantMessage,
          kind: 'web-search',
          sources: [{ title: 'Result', url: 'https://example.com', snippet: 'Snippet' }]
        },
        emotion: 'curious',
        intensity: 0.4,
        shortAction: ''
      })
    ).toMatchObject({ message: { kind: 'web-search', sources: [{ url: 'https://example.com' }] } });
  });

  it('rejects malformed events', () => {
    expect(parseChatStreamEvent({ type: 'turn-start' })).toBeUndefined();
    expect(
      parseChatStreamEvent({
        type: 'turn-segment',
        turnId: 'turn-1',
        index: -1,
        message: assistantMessage,
        emotion: 'neutral',
        intensity: 0.5,
        shortAction: ''
      })
    ).toBeUndefined();
    expect(
      parseChatStreamEvent({
        type: 'turn-segment',
        turnId: 'turn-1',
        index: 0,
        message: { ...assistantMessage, role: 'system' },
        emotion: 'neutral',
        intensity: 0.5,
        shortAction: ''
      })
    ).toBeUndefined();
    expect(
      parseChatStreamEvent({
        type: 'turn-segment',
        turnId: 'turn-1',
        index: 0,
        message: assistantMessage,
        emotion: 'happy',
        intensity: 2,
        shortAction: 'agree'
      })
    ).toBeUndefined();
    expect(parseChatStreamEvent({ type: 'turn-error', turnId: 'turn-1', message: '' })).toBeUndefined();
    expect(parseChatStreamEvent({ type: 'unknown', turnId: 'turn-1' })).toBeUndefined();
  });
});
