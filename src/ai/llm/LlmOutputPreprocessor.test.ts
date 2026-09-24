import { describe, expect, it } from 'vitest';
import { LlmOutputPreprocessor } from './LlmOutputPreprocessor';
import { defaultReplyShortActionId } from '../../character/motion/reply/shortActionVocabulary';

describe('LlmOutputPreprocessor', () => {
  it('wraps plain text after JSON parsing fails', () => {
    const intent = new LlmOutputPreprocessor().processAssistant('这是一句普通回复。');

    expect(intent).toEqual({
      replies: [
        {
          speech: '这是一句普通回复。',
          emotion: 'neutral',
          intensity: 0.5,
          shortAction: defaultReplyShortActionId,
          ttsEmotion: 'calm'
        }
      ],
      speech: '这是一句普通回复。',
      emotion: 'neutral',
      intensity: 0.5,
      soulEvent: 'chat',
      memories: []
    });
  });

  it('does not treat malformed JSON as plain text', () => {
    expect(() => new LlmOutputPreprocessor().processAssistant('{"speech":"未完成"')).toThrow();
  });
});
