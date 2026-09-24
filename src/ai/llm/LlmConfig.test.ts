import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLlmConfigForProvider, llmProviderOptions, saveLlmConfig } from './LlmConfig';

describe('LlmConfig', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    });
  });

  it('provides an API key acquisition link for every cloud provider', () => {
    const cloudProviders = llmProviderOptions.filter((option) => option.id !== 'ollama');

    expect(cloudProviders.every((option) => option.apiKeyUrl?.startsWith('https://'))).toBe(true);
  });

  it('restores the selected provider configuration instead of applying defaults', () => {
    saveLlmConfig({ provider: 'openai', model: 'gpt-4.1-mini', apiKey: 'openai-key', temperature: 1.3 });
    saveLlmConfig({
      provider: 'deepseek',
      model: 'deepseek-reasoner',
      apiKey: 'deepseek-key',
      temperature: 0.2
    });

    expect(getLlmConfigForProvider('openai')).toEqual({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      apiKey: 'openai-key',
      temperature: 1.3
    });
  });
});
