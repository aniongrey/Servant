import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultMemoryLlmConfig,
  loadMemoryLlmConfig,
  MEMORY_LLM_CONFIG_STORAGE_KEY,
  saveMemoryLlmConfig
} from './MemoryLlmConfig';

afterEach(() => vi.unstubAllGlobals());

describe('MemoryLlmConfig', () => {
  it('stores an independent deterministic provider config', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    });

    expect(loadMemoryLlmConfig()).toEqual(defaultMemoryLlmConfig);
    expect(
      saveMemoryLlmConfig({ provider: 'deepseek', model: 'deepseek-chat', apiKey: 'test', temperature: 1 })
    ).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'test',
      temperature: 0
    });
    expect(JSON.parse(values.get(MEMORY_LLM_CONFIG_STORAGE_KEY)!)).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-chat'
    });
  });

  it.each(['null', '[]', '"stale config"'])('ignores invalid stored shape %s', (raw) => {
    vi.stubGlobal('localStorage', {
      getItem: () => raw,
      setItem: vi.fn()
    });

    expect(loadMemoryLlmConfig()).toEqual(defaultMemoryLlmConfig);
  });
});
