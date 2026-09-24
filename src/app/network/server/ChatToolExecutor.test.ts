import { describe, expect, it, vi } from 'vitest';
import { preprocessConversationInput } from '../../../ai/llm/InputPreprocessor';
import { ChatToolRegistry } from '../../../ai/llm/ChatToolRegistry';
import { ChatToolExecutor } from './ChatToolExecutor';

describe('ChatToolExecutor', () => {
  it('validates and executes scheduler calls through the injected boundary', async () => {
    const registry = new ChatToolRegistry();
    const available = registry.listAvailable(preprocessConversationInput('十分钟后提醒我喝水'), false);
    const requestScheduler = vi.fn(async () => ({
      type: 'tool-result' as const,
      requestId: 'scheduler-1',
      tool: 'scheduler' as const,
      action: 'add',
      success: true,
      speech: '提醒已经设置好了。',
      content: { id: 'task-1' }
    }));
    const result = await new ChatToolExecutor(globalThis.fetch).execute(
      {
        name: 'scheduler',
        arguments: {
          action: 'add',
          name: '喝水',
          schedule: { type: 'once', at: 1 },
          text: '喝水'
        }
      },
      { available, userText: '十分钟后提醒我喝水', signal: new AbortController().signal, requestScheduler }
    );

    expect(requestScheduler).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ name: 'scheduler', speech: '提醒已经设置好了。', instruction: expect.stringContaining('task-1') });
  });
});
