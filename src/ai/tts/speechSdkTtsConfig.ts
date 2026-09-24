import {
  type SpeechSdkTtsProviderConfig,
  type SpeechSdkTtsLanguage,
  type SpeechSdkProviderId,
  type TtsTranslationConfig,
  type SpeechSdkAudioFormat
} from './speechSdkTypes';
import {
  getTtsProviderKind,
  getSpeechSdkProviderOption,
  speechSdkProviderOptions
} from './speechSdkProviderOptions';

export const SPEECH_SDK_TTS_CONFIG_STORAGE_KEY = 'codex-list.ttsConfig.v3';

export const SPEECH_SDK_TTS_PROVIDER_CONFIGS_STORAGE_KEY = 'codex-list.ttsConfig.providers.v1';

export const TTS_TRANSLATION_CONFIG_STORAGE_KEY = 'codex-list.ttsTranslationConfig.v1';

const DOUBAO_TTS_API_BASE = 'https://openspeech.bytedance.com/api/v3/tts/create';

const DOUBAO_TTS_SAMPLE_RATE = 48000;

// 初始参数：语音合成默认走本地 Microsoft 系统语音 —— 它不需要任何凭据，
// 装好就能出声，用户想换成远端供应商时再去设置里挑。
export const defaultSpeechSdkTtsProviderConfig: SpeechSdkTtsProviderConfig = {
  provider: 'microsoft',
  model: 'system-speech-synthesis',
  voice: '',
  apiKey: '',
  appId: '',
  apiBase: DOUBAO_TTS_API_BASE,
  sampleRate: DOUBAO_TTS_SAMPLE_RATE,
  loudnessRate: 0,
  pitchRate: 0,
  timeoutMs: 30000,
  instructions: '',
  speed: 1,
  outputFormat: 'mp3',
  ttsTranslationEnabled: false,
  // 初始参数：语种转换目标默认日语（与当前使用习惯一致），翻译开关默认关闭。
  ttsLanguage: 'ja'
};

export function getActiveSpeechSdkTtsLanguage(config: SpeechSdkTtsProviderConfig): SpeechSdkTtsLanguage {
  return config.ttsTranslationEnabled ? config.ttsLanguage : 'zh';
}

export function isSpeechSdkTtsConfigComplete(config: SpeechSdkTtsProviderConfig): boolean {
  const kind = getTtsProviderKind(config.provider);
  if (kind === 'disabled') return false;
  if (kind === 'local') return true;
  // A local GPT-SoVITS has no credentials: the only thing to configure is which
  // role preset to speak with.
  if (kind === 'gpt-sovits') return Boolean(config.voice.trim());
  return Boolean(
    config.model.trim() &&
      config.voice.trim() &&
      config.apiKey.trim() &&
      (config.provider !== 'doubao' || config.apiBase.trim())
  );
}

export function createDefaultSpeechSdkConfigForProvider(
  provider: SpeechSdkProviderId
): SpeechSdkTtsProviderConfig {
  const option = getSpeechSdkProviderOption(provider);
  return {
    ...defaultSpeechSdkTtsProviderConfig,
    provider,
    model: option.defaultModel,
    voice: option.defaultVoice
  };
}

export function getSpeechSdkConfigForProvider(
  provider: SpeechSdkProviderId,
  fallback?: SpeechSdkTtsProviderConfig
): SpeechSdkTtsProviderConfig {
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(getSpeechSdkConfigStorageKey(provider));
      if (raw) {
        const value = JSON.parse(raw) as Partial<SpeechSdkTtsProviderConfig> | null;
        if (value && typeof value === 'object' && isSpeechSdkProviderId(value.provider)) {
          return applyIndependentTtsTranslationConfig(normalizeSpeechSdkTtsProviderConfig(value));
        }
      }
    } catch {
      // fall through to fallback/default below
    }

    try {
      const raw = localStorage.getItem(SPEECH_SDK_TTS_CONFIG_STORAGE_KEY);
      if (raw) {
        const value = JSON.parse(raw) as Partial<SpeechSdkTtsProviderConfig> | null;
        if (value && typeof value === 'object' && value.provider === provider) {
          return applyIndependentTtsTranslationConfig(normalizeSpeechSdkTtsProviderConfig(value));
        }
      }
    } catch {
      // fall through to fallback/default below
    }
  }

  return applyIndependentTtsTranslationConfig(fallback ?? createDefaultSpeechSdkConfigForProvider(provider));
}

export function normalizeSpeechSdkTtsProviderConfig(
  value: Partial<SpeechSdkTtsProviderConfig> | undefined
): SpeechSdkTtsProviderConfig {
  const provider = isSpeechSdkProviderId(value?.provider)
    ? value.provider
    : defaultSpeechSdkTtsProviderConfig.provider;
  const option = getSpeechSdkProviderOption(provider);
  // The model field is free text: a hand-typed id that is not in `option.models`
  // must survive normalization, otherwise the value the user typed is silently
  // replaced by the provider default on every keystroke, on save and on load.
  // Only an empty value falls back.
  const requestedModel = typeof value?.model === 'string' ? value.model.trim() : '';
  const model = requestedModel || option.defaultModel;
  const requestedVoice = typeof value?.voice === 'string' ? value.voice.trim() : '';
  const voice =
    option.voices.some((item) => item.id === requestedVoice) || (option.customVoice && requestedVoice)
      ? requestedVoice
      : option.defaultVoice;
  const speed =
    typeof value?.speed === 'number' && Number.isFinite(value.speed)
      ? Math.min(1.5, Math.max(0.75, value.speed))
      : defaultSpeechSdkTtsProviderConfig.speed;

  return {
    provider,
    model,
    voice,
    apiKey: typeof value?.apiKey === 'string' ? value.apiKey : '',
    appId: typeof value?.appId === 'string' ? value.appId : '',
    apiBase:
      typeof value?.apiBase === 'string' && value.apiBase.trim()
        ? value.apiBase.trim()
        : defaultSpeechSdkTtsProviderConfig.apiBase,
    sampleRate:
      typeof value?.sampleRate === 'number' && Number.isFinite(value.sampleRate)
        ? Math.min(48000, Math.max(8000, Math.round(value.sampleRate)))
        : defaultSpeechSdkTtsProviderConfig.sampleRate,
    loudnessRate:
      typeof value?.loudnessRate === 'number' && Number.isFinite(value.loudnessRate)
        ? Math.min(10, Math.max(-10, value.loudnessRate))
        : defaultSpeechSdkTtsProviderConfig.loudnessRate,
    pitchRate:
      typeof value?.pitchRate === 'number' && Number.isFinite(value.pitchRate)
        ? Math.min(10, Math.max(-10, value.pitchRate))
        : defaultSpeechSdkTtsProviderConfig.pitchRate,
    timeoutMs:
      typeof value?.timeoutMs === 'number' && Number.isFinite(value.timeoutMs)
        ? Math.min(120000, Math.max(1000, Math.round(value.timeoutMs)))
        : defaultSpeechSdkTtsProviderConfig.timeoutMs,
    instructions: typeof value?.instructions === 'string' ? value.instructions : '',
    speed,
    outputFormat:
      provider === 'doubao' && value?.outputFormat === 'pcm'
        ? 'mp3'
        : isSpeechSdkAudioFormat(value?.outputFormat)
        ? value.outputFormat
        : defaultSpeechSdkTtsProviderConfig.outputFormat,
    ttsTranslationEnabled: value?.ttsTranslationEnabled === true,
    ttsLanguage: isSpeechSdkTtsLanguage(value?.ttsLanguage)
      ? value.ttsLanguage
      : defaultSpeechSdkTtsProviderConfig.ttsLanguage
  };
}

export function loadSpeechSdkTtsConfig(): SpeechSdkTtsProviderConfig {
  if (typeof localStorage === 'undefined') return defaultSpeechSdkTtsProviderConfig;
  try {
    const raw = localStorage.getItem(SPEECH_SDK_TTS_CONFIG_STORAGE_KEY);
    if (raw) {
      const currentValue = JSON.parse(raw) as Partial<SpeechSdkTtsProviderConfig> | null;
      if (currentValue && typeof currentValue === 'object' && isSpeechSdkProviderId(currentValue.provider)) {
        return applyIndependentTtsTranslationConfig(normalizeSpeechSdkTtsProviderConfig(currentValue));
      }
    }

    for (const provider of speechSdkProviderOptions.map((option) => option.id)) {
      const providerRaw = localStorage.getItem(getSpeechSdkConfigStorageKey(provider));
      if (!providerRaw) continue;
      const value = JSON.parse(providerRaw) as Partial<SpeechSdkTtsProviderConfig> | null;
      if (value && typeof value === 'object' && isSpeechSdkProviderId(value.provider)) {
        return applyIndependentTtsTranslationConfig(normalizeSpeechSdkTtsProviderConfig(value));
      }
    }

    return defaultSpeechSdkTtsProviderConfig;
  } catch {
    return defaultSpeechSdkTtsProviderConfig;
  }
}

export function saveSpeechSdkTtsConfig(config: SpeechSdkTtsProviderConfig): void {
  if (typeof localStorage === 'undefined') return;
  const normalized = normalizeSpeechSdkTtsProviderConfig(config);
  const { ttsTranslationEnabled, ttsLanguage, ...providerConfig } = normalized;
  localStorage.setItem(
    TTS_TRANSLATION_CONFIG_STORAGE_KEY,
    JSON.stringify({ ttsTranslationEnabled, ttsLanguage })
  );
  localStorage.setItem(getSpeechSdkConfigStorageKey(normalized.provider), JSON.stringify(providerConfig));
  localStorage.setItem(SPEECH_SDK_TTS_CONFIG_STORAGE_KEY, JSON.stringify(providerConfig));
}

function applyIndependentTtsTranslationConfig(
  config: SpeechSdkTtsProviderConfig
): SpeechSdkTtsProviderConfig {
  const translation = loadIndependentTtsTranslationConfig({
    ttsTranslationEnabled: config.ttsTranslationEnabled,
    ttsLanguage: config.ttsLanguage
  });
  return { ...config, ...translation };
}

function loadIndependentTtsTranslationConfig(fallback: TtsTranslationConfig): TtsTranslationConfig {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(TTS_TRANSLATION_CONFIG_STORAGE_KEY);
    if (raw) {
      const value = JSON.parse(raw) as Partial<TtsTranslationConfig> | null;
      if (value && typeof value === 'object') return normalizeTtsTranslationConfig(value, fallback);
    }
  } catch {
    // Keep the caller's normalized values when stored data is malformed.
  }
  return fallback;
}

function normalizeTtsTranslationConfig(
  value: Partial<TtsTranslationConfig>,
  fallback: TtsTranslationConfig
): TtsTranslationConfig {
  return {
    ttsTranslationEnabled:
      typeof value.ttsTranslationEnabled === 'boolean'
        ? value.ttsTranslationEnabled
        : fallback.ttsTranslationEnabled,
    ttsLanguage: isSpeechSdkTtsLanguage(value.ttsLanguage) ? value.ttsLanguage : fallback.ttsLanguage
  };
}

function getSpeechSdkConfigStorageKey(provider: SpeechSdkProviderId): string {
  return `codex-list.ttsConfig.provider.${provider}`;
}

function isSpeechSdkProviderId(value: unknown): value is SpeechSdkProviderId {
  return speechSdkProviderOptions.some((option) => option.id === value);
}

function isSpeechSdkAudioFormat(value: unknown): value is SpeechSdkAudioFormat {
  return value === 'mp3' || value === 'wav' || value === 'pcm';
}

function isSpeechSdkTtsLanguage(value: unknown): value is SpeechSdkTtsLanguage {
  return value === 'zh' || value === 'ja' || value === 'en' || value === 'ko';
}
