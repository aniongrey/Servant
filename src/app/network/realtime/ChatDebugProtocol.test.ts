import { describe, expect, it } from 'vitest';
import { parseChatDebugEvent } from './ChatDebugProtocol';

describe('chat debug protocol', () => {
  it('accepts read-only context diagnostics with memory timestamps', () => {
    expect(
      parseChatDebugEvent({
        type: 'context',
        turnId: 'turn-1',
        at: 1,
        input: { text: '你好', toolCandidates: [], requiresSchedulerTool: false, requiresWebSearchTool: false },
        tools: [],
        memory: { query: '你好', entries: [{ summary: '喜欢咖啡', event_time_start: null, created_at: '2026-01-01T00:00:00.000Z' }] }
      })
    ).toMatchObject({ type: 'context', turnId: 'turn-1' });
  });
});
