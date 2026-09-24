import { describe, expect, it } from 'vitest';
import { preprocessConversationInput } from './InputPreprocessor';

describe('preprocessConversationInput', () => {
  it('normalizes input and only marks deterministic tool candidates', () => {
    expect(preprocessConversationInput('  查一下  今天金价 ')).toMatchObject({
      text: '查一下 今天金价',
      isEmpty: false,
      isLikelyNoise: false,
      requiresSchedulerTool: false,
      requiresWebSearchTool: true,
      toolCandidates: ['web-search']
    });
    expect(preprocessConversationInput('十分钟后提醒我喝水')).toMatchObject({
      toolCandidates: ['scheduler'],
      requiresSchedulerTool: true,
      requiresWebSearchTool: false
    });
  });

  it('does not discard meaningful short companion speech', () => {
    expect(preprocessConversationInput('嗯')).toMatchObject({ isLikelyNoise: false, toolCandidates: [] });
    expect(preprocessConversationInput('[BLANK_AUDIO]').isLikelyNoise).toBe(true);
  });
});
