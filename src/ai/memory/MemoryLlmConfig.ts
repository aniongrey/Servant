import {
  createDefaultLlmConfigForProvider,
  normalizeLlmConfig,
  type LlmConfig,
  type LlmProviderId
} from '../llm/LlmConfig';

export const MEMORY_LLM_CONFIG_STORAGE_KEY = 'codex-list.memoryLlmConfig.v1';
export const defaultMemoryLlmConfig: LlmConfig = {
  provider: 'ollama',
  model: 'qwen3.5:9b',
  apiKey: '',
  temperature: 0
};

export function loadMemoryLlmConfig(): LlmConfig {
  if (typeof localStorage === 'undefined') return defaultMemoryLlmConfig;
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(MEMORY_LLM_CONFIG_STORAGE_KEY) ?? 'null'
    );
    return isConfigRecord(saved) ? normalizeMemoryLlmConfig(saved) : defaultMemoryLlmConfig;
  } catch {
    return defaultMemoryLlmConfig;
  }
}

export function saveMemoryLlmConfig(config: LlmConfig): LlmConfig {
  const normalized = normalizeMemoryLlmConfig(config);
  localStorage.setItem(MEMORY_LLM_CONFIG_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function createMemoryLlmConfigForProvider(provider: LlmProviderId): LlmConfig {
  return { ...createDefaultLlmConfigForProvider(provider), temperature: 0 };
}

export function normalizeMemoryLlmConfig(config: Partial<LlmConfig>): LlmConfig {
  return { ...normalizeLlmConfig({ ...config, temperature: 0 }), temperature: 0 };
}

function isConfigRecord(value: unknown): value is Partial<LlmConfig> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
