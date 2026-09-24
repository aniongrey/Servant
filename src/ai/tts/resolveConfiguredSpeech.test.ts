import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConfiguredSpeech } from './resolveConfiguredSpeech';

const mocks = vi.hoisted(() => ({
  config: { ttsTranslationEnabled: true, ttsLanguage: 'ja' },
  translate: vi.fn(async () => '頭をなでないで。')
}));
vi.mock('./speechSdkTtsConfig', () => ({ loadSpeechSdkTtsConfig: () => mocks.config }));
vi.mock('./MyMemoryTranslator', () => ({ translateWithMyMemory: mocks.translate }));

beforeEach(() => {
  mocks.config.ttsTranslationEnabled = true;
  mocks.config.ttsLanguage = 'ja';
  mocks.translate.mockReset().mockResolvedValue('頭をなでないで。');
});

describe('configured fixed-line conversion', () => {
  it('reads the current language setting and skips translation when disabled or Chinese', async () => {
    expect(await resolveConfiguredSpeech('不要摸头。')).toBe('頭をなでないで。');
    expect(mocks.translate).toHaveBeenCalledWith('不要摸头。', 'ja', undefined);
    mocks.config.ttsTranslationEnabled = false;
    expect(await resolveConfiguredSpeech('不要摸头。')).toBe('不要摸头。');
    mocks.config.ttsTranslationEnabled = true;
    mocks.config.ttsLanguage = 'zh';
    expect(await resolveConfiguredSpeech('不要摸头。')).toBe('不要摸头。');
    expect(mocks.translate).toHaveBeenCalledOnce();
  });

  it('uses conversation fallback when translation fails', async () => {
    mocks.translate.mockRejectedValue(new Error('Offline'));
    expect(await resolveConfiguredSpeech('不要摸头。')).toBe('不要摸头。');
  });
});
