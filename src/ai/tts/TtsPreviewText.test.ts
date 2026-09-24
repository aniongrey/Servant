import { describe, expect, it, vi } from 'vitest';
import { resolveTtsPreviewText } from './TtsPreviewText';

describe('resolveTtsPreviewText', () => {
  it('keeps the original preview when conversion is disabled', async () => {
    const translate = vi.fn();
    await expect(
      resolveTtsPreviewText(
        ' 你好 ',
        {
          ttsTranslationEnabled: false,
          ttsLanguage: 'ja'
        },
        translate
      )
    ).resolves.toBe('你好');
    expect(translate).not.toHaveBeenCalled();
  });

  it('uses the same LLM translation path for a converted preview', async () => {
    const translate = vi.fn(async () => ' こんにちは ');
    await expect(
      resolveTtsPreviewText(
        '你好',
        {
          ttsTranslationEnabled: true,
          ttsLanguage: 'ja'
        },
        translate
      )
    ).resolves.toBe('こんにちは');
    expect(translate).toHaveBeenCalledWith('你好', 'ja', undefined);
  });

  it('rejects an empty translation instead of silently reading the source language', async () => {
    await expect(
      resolveTtsPreviewText(
        '你好',
        {
          ttsTranslationEnabled: true,
          ttsLanguage: 'en'
        },
        async () => '   '
      )
    ).rejects.toThrow('语言转换没有返回可朗读文本');
  });
});
