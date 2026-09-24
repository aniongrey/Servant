export const LLM_CONFIG_STORAGE_KEY = 'codex-list.llmConfig.v2';
export const DOUBAO_LLM_OPEN_MANAGEMENT_URL =
  'https://console.volcengine.com/ark/region:cn-beijing/openManagement?LLM=%7B%7D&OpenModelVisible=false&advancedActiveKey=model';
export const DOUBAO_LLM_API_KEYS_URL =
  'https://console.volcengine.com/ark/region:cn-beijing/apiKey?apikey=%7B%7D';
export const DEEPSEEK_API_KEYS_URL = 'https://platform.deepseek.com/api_keys';

export type LlmProviderId =
  | 'ollama'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'xai'
  | 'mistral'
  | 'groq'
  | 'deepseek'
  | 'cohere'
  | 'doubao';

export interface LlmProviderOption {
  id: LlmProviderId;
  label: string;
  apiKeyLabel?: string;
  apiKeyUrl?: string;
  models: readonly string[];
  defaultModel: string;
}

export interface LlmConfig {
  provider: LlmProviderId;
  model: string;
  apiKey: string;
  temperature: number;
}

export interface DoubaoLlmQuickModel {
  id: string;
  label: string;
  group: 'DeepSeek' | '官方推荐' | '常用模型';
}

export const doubaoLlmQuickModels: readonly DoubaoLlmQuickModel[] = [
  { id: 'deepseek-v4-pro-ga-260813', label: 'DeepSeek V4 Pro GA（推荐）', group: 'DeepSeek' },
  { id: 'deepseek-v4-flash-ga-260731', label: 'DeepSeek V4 Flash GA（快速）', group: 'DeepSeek' },
  { id: 'deepseek-v4-pro-260425', label: 'DeepSeek V4 Pro', group: 'DeepSeek' },
  { id: 'deepseek-v4-flash-260425', label: 'DeepSeek V4 Flash', group: 'DeepSeek' },
  { id: 'doubao-seed-2-1-pro-260628', label: '豆包 Seed 2.1 Pro（推荐）', group: '官方推荐' },
  { id: 'doubao-seed-2-1-turbo-260628', label: '豆包 Seed 2.1 Turbo（高性价比）', group: '官方推荐' },
  { id: 'doubao-seed-evolving', label: '豆包 Seed Evolving（Coding / Agent）', group: '官方推荐' },
  { id: 'doubao-seed-character-260628', label: '豆包 Seed Character（角色陪伴）', group: '常用模型' },
  { id: 'doubao-seed-2-0-lite-260428', label: '豆包 Seed 2.0 Lite（低成本）', group: '常用模型' },
  { id: 'glm-5-2-260617', label: 'GLM 5.2', group: '常用模型' }
] as const;

export const llmProviderOptions: readonly LlmProviderOption[] = [
  {
    id: 'ollama',
    label: 'Ollama（本地）',
    models: ['qwen3.5:9b', 'qwen3.5:4b', 'qwen2.5:latest'],
    defaultModel: 'qwen3.5:9b'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    apiKeyLabel: 'OpenAI API Key',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    models: ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-4.1-mini'],
    defaultModel: 'gpt-5.6-luna'
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    apiKeyLabel: 'Anthropic API Key',
    apiKeyUrl: 'https://platform.claude.com/settings/keys',
    models: ['claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
    defaultModel: 'claude-sonnet-5'
  },
  {
    id: 'google',
    label: 'Google Gemini',
    apiKeyLabel: 'Google AI API Key',
    apiKeyUrl: 'https://aistudio.google.com/api-keys',
    models: ['gemini-3.1-pro-preview', 'gemini-3-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'],
    defaultModel: 'gemini-2.5-flash'
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    apiKeyLabel: 'xAI API Key',
    apiKeyUrl: 'https://console.x.ai/team/default/api-keys',
    models: ['grok-4-1-fast-non-reasoning', 'grok-4-1-fast-reasoning', 'grok-4-1', 'grok-4'],
    defaultModel: 'grok-4-1-fast-non-reasoning'
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    apiKeyLabel: 'Mistral API Key',
    apiKeyUrl: 'https://console.mistral.ai/api-keys/',
    models: ['mistral-large-latest', 'mistral-small-latest', 'ministral-8b-latest', 'pixtral-large-latest'],
    defaultModel: 'mistral-small-latest'
  },
  {
    id: 'groq',
    label: 'Groq',
    apiKeyLabel: 'Groq API Key',
    apiKeyUrl: 'https://console.groq.com/keys',
    models: [
      'openai/gpt-oss-120b',
      'llama-3.3-70b-versatile',
      'qwen/qwen3-32b',
      'meta-llama/llama-4-scout-17b-16e-instruct'
    ],
    defaultModel: 'openai/gpt-oss-120b'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    apiKeyLabel: 'DeepSeek API Key',
    apiKeyUrl: DEEPSEEK_API_KEYS_URL,
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat'
  },
  {
    id: 'cohere',
    label: 'Cohere',
    apiKeyLabel: 'Cohere API Key',
    apiKeyUrl: 'https://dashboard.cohere.com/api-keys',
    models: ['command-a-03-2025', 'command-a-reasoning-08-2025', 'command-r-plus', 'command-r'],
    defaultModel: 'command-a-03-2025'
  },
  {
    id: 'doubao',
    label: '豆包（火山方舟）',
    apiKeyLabel: '火山方舟 API Key',
    apiKeyUrl: DOUBAO_LLM_API_KEYS_URL,
    models: doubaoLlmQuickModels.map((model) => model.id),
    defaultModel: 'doubao-seed-2-1-turbo-260628'
  }
] as const;

const recommendedLlmProviderIds: readonly LlmProviderId[] = ['ollama', 'deepseek', 'doubao'];

export const recommendedLlmProviderOptions: readonly LlmProviderOption[] = recommendedLlmProviderIds.map(
  (provider) => getLlmProviderOption(provider)
);

export const otherLlmProviderOptions: readonly LlmProviderOption[] = llmProviderOptions
  .filter((option) => !recommendedLlmProviderIds.includes(option.id))
  .sort((left, right) => left.label.localeCompare(right.label, 'en', { sensitivity: 'base' }));

// 初始参数：本地 Ollama + qwen3.5:9b，采样温度 0.3（角色扮演用低温度更稳）。
export const defaultLlmConfig: LlmConfig = {
  provider: 'ollama',
  model: 'qwen3.5:9b',
  apiKey: '',
  temperature: 0.3
};

export function loadLlmConfig(): LlmConfig {
  if (typeof localStorage === 'undefined') return defaultLlmConfig;

  try {
    const saved = JSON.parse(
      localStorage.getItem(LLM_CONFIG_STORAGE_KEY) ?? 'null'
    ) as Partial<LlmConfig> | null;
    return normalizeLlmConfig(saved ?? undefined);
  } catch {
    return defaultLlmConfig;
  }
}

export function saveLlmConfig(config: LlmConfig): void {
  if (typeof localStorage === 'undefined') return;
  const normalized = normalizeLlmConfig(config);
  localStorage.setItem(LLM_CONFIG_STORAGE_KEY, JSON.stringify(normalized));
  localStorage.setItem(getLlmConfigStorageKey(normalized.provider), JSON.stringify(normalized));
}

export function getLlmConfigForProvider(provider: LlmProviderId): LlmConfig {
  if (typeof localStorage !== 'undefined') {
    try {
      const saved = JSON.parse(
        localStorage.getItem(getLlmConfigStorageKey(provider)) ?? 'null'
      ) as Partial<LlmConfig> | null;
      if (saved && typeof saved === 'object' && saved.provider === provider) {
        return normalizeLlmConfig(saved);
      }
    } catch {
      // Fall through to the provider default when storage is malformed.
    }
  }
  return createDefaultLlmConfigForProvider(provider);
}

export function normalizeLlmConfig(value: Partial<LlmConfig> | undefined): LlmConfig {
  const provider = isLlmProviderId(value?.provider) ? value.provider : defaultLlmConfig.provider;
  const option = getLlmProviderOption(provider);
  const requestedModel = typeof value?.model === 'string' ? value.model.trim() : '';
  const model = requestedModel || option.defaultModel;
  const temperature =
    typeof value?.temperature === 'number' && Number.isFinite(value.temperature)
      ? Math.min(2, Math.max(0, value.temperature))
      : defaultLlmConfig.temperature;

  return {
    provider,
    model,
    apiKey: typeof value?.apiKey === 'string' ? value.apiKey : '',
    temperature
  };
}

export function getLlmProviderOption(provider: LlmProviderId): LlmProviderOption {
  return llmProviderOptions.find((option) => option.id === provider) ?? llmProviderOptions[0];
}

export function createDefaultLlmConfigForProvider(provider: LlmProviderId): LlmConfig {
  const option = getLlmProviderOption(provider);
  return {
    provider,
    model: option.defaultModel,
    apiKey: '',
    temperature: defaultLlmConfig.temperature
  };
}

export function llmModelSupportsTemperature(config: Pick<LlmConfig, 'provider' | 'model'>): boolean {
  return !(
    (config.provider === 'openai' && config.model.startsWith('gpt-5')) ||
    (config.provider === 'xai' && config.model.includes('reasoning')) ||
    (config.provider === 'groq' && /(gpt-oss|qwen3)/.test(config.model)) ||
    (config.provider === 'deepseek' && config.model === 'deepseek-reasoner')
  );
}

function isLlmProviderId(value: unknown): value is LlmProviderId {
  return llmProviderOptions.some((option) => option.id === value);
}

function getLlmConfigStorageKey(provider: LlmProviderId): string {
  return `codex-list.llmConfig.provider.${provider}`;
}
