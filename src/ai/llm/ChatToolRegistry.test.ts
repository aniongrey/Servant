import { describe, expect, it } from 'vitest';
import { ChatToolRegistry, buildAvailableToolsPrompt } from './ChatToolRegistry';
import { preprocessConversationInput } from './InputPreprocessor';

describe('ChatToolRegistry', () => {
  const registry = new ChatToolRegistry();

  it('offers search when enabled and scheduler only to matching requests', () => {
    expect(registry.listAvailable(preprocessConversationInput('你好'), true).map(({ name }) => name)).toEqual([
      'web-search'
    ]);
    expect(
      registry.listAvailable(preprocessConversationInput('十分钟后提醒我喝水'), false).map(({ name }) => name)
    ).toEqual(['scheduler']);
  });

  it('validates calls at the execution boundary', () => {
    const tools = registry.listAvailable(preprocessConversationInput('查一下天气'), true);
    expect(
      registry.validate(
        { name: 'web-search', arguments: { query: '香港天气', resolvedQuestion: '香港今天的天气如何？' } },
        tools,
        '查一下天气'
      )
    ).toMatchObject({ name: 'web-search', arguments: { query: '香港天气' } });
    expect(() =>
      registry.validate({ name: 'scheduler', arguments: { action: 'list' } }, tools, '查一下天气')
    ).toThrow('工具不可用');
  });

  it('describes one complete tool-call protocol', () => {
    const prompt = buildAvailableToolsPrompt(
      registry.listAvailable(preprocessConversationInput('十分钟后提醒我喝水'), false)
    );
    expect(prompt).toContain('<tool_call>');
    expect(prompt).toContain('不要同时输出台词');
  });
});
