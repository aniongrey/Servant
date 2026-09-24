export type SpeechSdkProviderId =
  | 'none'
  | 'microsoft'
  | 'gpt-sovits'
  | 'openai'
  | 'elevenlabs'
  | 'deepgram'
  | 'google'
  | 'cartesia'
  | 'fal'
  | 'fish'
  | 'gradium'
  | 'hume'
  | 'inworld'
  | 'minimax'
  | 'doubao'
  | 'mistral'
  | 'murf'
  | 'resemble'
  | 'smallestai'
  | 'speechify'
  | 'xai';

export type SpeechSdkTtsLanguage = 'zh' | 'ja' | 'en' | 'ko';

export type SpeechSdkAudioFormat = 'mp3' | 'wav' | 'pcm';

export interface SpeechSdkSelectOption {
  id: string;
  label: string;
}

/**
 * `kind` decides which fields a provider exposes in the settings UI:
 * - `disabled` — no speech at all;
 * - `local` — the OS voices, no credentials;
 * - `speech-sdk` — the remote providers: model, voice and API key;
 * - `gpt-sovits` — a local engine whose only setting is a role preset, which is
 *   maintained on its own page.
 */
export interface SpeechSdkProviderOption {
  id: SpeechSdkProviderId;
  label: string;
  models: readonly SpeechSdkSelectOption[];
  voices: readonly SpeechSdkSelectOption[];
  defaultModel: string;
  defaultVoice: string;
  instructionModels: readonly string[];
  apiKeyUrl?: string;
  customVoice?: boolean;
  voiceHint?: string;
  kind?: 'disabled' | 'local' | 'speech-sdk' | 'gpt-sovits';
}

export interface SpeechSdkTtsProviderConfig {
  provider: SpeechSdkProviderId;
  model: string;
  voice: string;
  apiKey: string;
  appId: string;
  apiBase: string;
  sampleRate: number;
  loudnessRate: number;
  pitchRate: number;
  timeoutMs: number;
  instructions: string;
  speed: number;
  outputFormat: SpeechSdkAudioFormat;
  ttsTranslationEnabled: boolean;
  ttsLanguage: SpeechSdkTtsLanguage;
}

export interface TtsTranslationConfig {
  ttsTranslationEnabled: boolean;
  ttsLanguage: SpeechSdkTtsLanguage;
}
