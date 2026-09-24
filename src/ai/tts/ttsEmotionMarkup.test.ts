import { describe, expect, it } from 'vitest';
import { buildTtsEmotionPrompt, resolveTtsEmotionMarkup, stripTtsEmotionMarkup } from './ttsEmotionMarkup';

describe('TTS emotion markup', () => {
  it('enables markup only for Fish S2 and Doubao 2.0 models', () => {
    expect(resolveTtsEmotionMarkup({ provider: 'fish', model: 's2-pro' })).toBe('fish-s2');
    expect(resolveTtsEmotionMarkup({ provider: 'doubao', model: 'seed-tts-2.0' })).toBe('doubao-2');
    expect(resolveTtsEmotionMarkup({ provider: 'doubao', model: 'seed-tts-1.0' })).toBeUndefined();
    expect(resolveTtsEmotionMarkup({ provider: 'openai', model: 'gpt-4o-mini-tts' })).toBeUndefined();
  });

  it('keeps cues for TTS prompts but removes them from local display text', () => {
    expect(stripTtsEmotionMarkup('[happy] 太好啦！\n[sobbing] 我只是有点感动。', 'fish-s2')).toBe(
      '太好啦！\n我只是有点感动。'
    );
    expect(stripTtsEmotionMarkup('[开心地说]欢迎回来。', 'doubao-2')).toBe('欢迎回来。');
    expect(buildTtsEmotionPrompt('fish-s2')).toContain('[sobbing]');
    expect(buildTtsEmotionPrompt('doubao-2')).toContain('[开心地说]');
  });
});
