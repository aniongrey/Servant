import { describe, expect, it } from 'vitest';
import { rankModelSuggestions } from './ModelInput';

describe('rankModelSuggestions', () => {
  const models = [
    { id: 'other-model', label: '其他模型' },
    { id: 'seed-tts-2.0', label: '豆包默认音色' },
    { id: 'tts-1', label: 'TTS 1' },
    { id: 'tts', label: 'TTS' }
  ];

  it('keeps every preset and ranks exact, prefix, partial and unrelated matches', () => {
    expect(rankModelSuggestions(models, ' TTS ').map((model) => model.id)).toEqual([
      'tts',
      'tts-1',
      'seed-tts-2.0',
      'other-model'
    ]);
    expect(models[0].id).toBe('other-model');
  });

  it('matches display names as well as IDs', () => {
    expect(rankModelSuggestions(models, '豆包')[0].id).toBe('seed-tts-2.0');
  });

  it('keeps the original order when empty or unmatched without hiding presets', () => {
    expect(rankModelSuggestions(models, '')).toEqual(models);
    expect(rankModelSuggestions(models, 'custom-model')).toEqual(models);
  });
});
