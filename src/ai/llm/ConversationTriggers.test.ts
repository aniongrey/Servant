import { describe, expect, it } from 'vitest';
import { requiresSchedulerTool, requiresWebSearchTool, shouldUseSchedulerTool } from './ConversationTriggers';

describe('shouldUseSchedulerTool', () => {
  it('matches creation and management requests', () => {
    expect(shouldUseSchedulerTool('十分钟后提醒我喝水')).toBe(true);
    expect(shouldUseSchedulerTool('我现在有哪些提醒？')).toBe(true);
    expect(shouldUseSchedulerTool('取消开会提醒')).toBe(true);
    expect(shouldUseSchedulerTool('把吃饭提醒改成晚上八点半')).toBe(true);
    expect(shouldUseSchedulerTool('明天八点设个闹钟')).toBe(true);
  });

  it('excludes negation and meta discussion', () => {
    expect(shouldUseSchedulerTool('不用提醒我喝水')).toBe(false);
    expect(shouldUseSchedulerTool('“提醒我”这个触发器怎么写')).toBe(false);
    expect(shouldUseSchedulerTool('她刚才提醒我带伞')).toBe(false);
  });

  it('marks direct reminder commands as mandatory tool calls', () => {
    expect(requiresSchedulerTool('10秒钟后叫我。')).toBe(true);
    expect(requiresSchedulerTool('不用叫我。')).toBe(false);
    expect(requiresSchedulerTool('明天天气怎么样？')).toBe(false);
  });

  it('marks explicit online-search commands as mandatory tool calls', () => {
    expect(requiresWebSearchTool('帮我搜索今天的金价')).toBe(true);
    expect(requiresWebSearchTool('今天天气怎么样？')).toBe(false);
  });
});
