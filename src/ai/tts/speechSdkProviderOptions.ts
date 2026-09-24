import {
  type SpeechSdkProviderOption,
  type SpeechSdkProviderId,
  type SpeechSdkTtsProviderConfig
} from './speechSdkTypes';

const openAiVoices = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'onyx',
  'nova',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar'
].map((id) => ({ id, label: id }));

export const DOUBAO_VOICE_CONSOLE_URL =
  'https://console.volcengine.com/speech/new/voices?projectName=default';

export const DOUBAO_TTS_API_KEYS_URL =
  'https://console.volcengine.com/speech/new/setting/apikeys?projectName=default';

const DOUBAO_TTS_VOICES_URL = 'https://console.volcengine.com/speech/new/voices?projectName=default';

const DOUBAO_TTS_CLONE_URL = 'https://console.volcengine.com/speech/new/experience/clone?projectName=default';

export const speechSdkProviderOptions: readonly SpeechSdkProviderOption[] = [
  {
    id: 'none',
    label: '无（关闭语音）',
    models: [],
    voices: [],
    defaultModel: '',
    defaultVoice: '',
    instructionModels: [],
    kind: 'disabled'
  },
  {
    id: 'microsoft',
    label: '本地 Microsoft',
    models: [{ id: 'system-speech-synthesis', label: 'Windows 系统语音' }],
    voices: [],
    defaultModel: 'system-speech-synthesis',
    defaultVoice: '',
    instructionModels: [],
    kind: 'local'
  },
  {
    // Local engine: no model list and no credentials, just a role preset that
    // the studio page owns. `customVoice` keeps the stored voice value intact
    // even though the id is not part of a static list.
    id: 'gpt-sovits',
    label: 'GPT-SoVITS',
    models: [{ id: 'api_v2', label: 'GPT-SoVITS api_v2（本地 9880）' }],
    voices: [],
    defaultModel: 'api_v2',
    defaultVoice: '',
    instructionModels: [],
    customVoice: true,
    voiceHint: '角色预设（在 GPT-SoVITS 配置页维护）',
    kind: 'gpt-sovits'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-4o-mini-tts', label: 'GPT-4o mini TTS' },
      { id: 'tts-1', label: 'TTS-1（低延迟）' },
      { id: 'tts-1-hd', label: 'TTS-1 HD（高质量）' }
    ],
    voices: openAiVoices,
    defaultModel: 'gpt-4o-mini-tts',
    defaultVoice: 'alloy',
    instructionModels: ['gpt-4o-mini-tts']
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    apiKeyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    models: [
      { id: 'eleven_v3', label: 'Eleven v3' },
      { id: 'eleven_multilingual_v2', label: 'Multilingual v2' },
      { id: 'eleven_flash_v2_5', label: 'Flash v2.5' }
    ],
    voices: [
      { id: 'JBFqnCBsd6RMkjVDRZzb', label: 'George' },
      { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah' }
    ],
    defaultModel: 'eleven_multilingual_v2',
    defaultVoice: 'JBFqnCBsd6RMkjVDRZzb',
    instructionModels: [],
    customVoice: true,
    voiceHint: 'ElevenLabs Voice ID'
  },
  {
    id: 'deepgram',
    label: 'Deepgram',
    apiKeyUrl: 'https://console.deepgram.com/',
    models: [{ id: 'aura-2', label: 'Aura 2' }],
    voices: [
      { id: 'thalia-en', label: 'Thalia · EN' },
      { id: 'andromeda-en', label: 'Andromeda · EN' },
      { id: 'apollo-en', label: 'Apollo · EN' },
      { id: 'arcas-en', label: 'Arcas · EN' },
      { id: 'asteria-en', label: 'Asteria · EN' },
      { id: 'athena-en', label: 'Athena · EN' }
    ],
    defaultModel: 'aura-2',
    defaultVoice: 'thalia-en',
    instructionModels: []
  },
  {
    id: 'google',
    label: 'Google Gemini',
    apiKeyUrl: 'https://aistudio.google.com/api-keys',
    models: [
      { id: 'gemini-3.1-flash-tts-preview', label: 'Gemini 3.1 Flash TTS Preview' },
      { id: 'gemini-2.5-flash-preview-tts', label: 'Gemini 2.5 Flash TTS Preview' },
      { id: 'gemini-2.5-pro-preview-tts', label: 'Gemini 2.5 Pro TTS Preview' }
    ],
    voices: ['Kore', 'Puck', 'Charon', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'].map((id) => ({
      id,
      label: id
    })),
    defaultModel: 'gemini-2.5-flash-preview-tts',
    defaultVoice: 'Kore',
    instructionModels: [
      'gemini-3.1-flash-tts-preview',
      'gemini-2.5-flash-preview-tts',
      'gemini-2.5-pro-preview-tts'
    ]
  },
  {
    id: 'cartesia',
    label: 'Cartesia',
    apiKeyUrl: 'https://play.cartesia.ai/keys',
    models: [
      { id: 'sonic-3.5', label: 'Sonic 3.5' },
      { id: 'sonic-3', label: 'Sonic 3' },
      { id: 'sonic-2', label: 'Sonic 2' }
    ],
    voices: [],
    defaultModel: 'sonic-3.5',
    defaultVoice: '',
    instructionModels: [],
    customVoice: true,
    voiceHint: 'Cartesia Voice ID'
  },
  {
    id: 'fal',
    label: 'fal.ai',
    apiKeyUrl: 'https://fal.ai/dashboard/keys',
    models: [
      { id: 'f5-tts', label: 'F5-TTS' },
      { id: 'kokoro', label: 'Kokoro' },
      { id: 'orpheus-tts', label: 'Orpheus TTS' }
    ],
    voices: [],
    defaultModel: 'kokoro',
    defaultVoice: '',
    instructionModels: [],
    customVoice: true,
    voiceHint: 'fal Voice / Speaker ID'
  },
  {
    id: 'fish',
    label: 'Fish Audio',
    apiKeyUrl: 'https://fish.audio/app/api-keys/',
    models: [{ id: 's2-pro', label: 'S2 Pro' }],
    voices: [],
    defaultModel: 's2-pro',
    defaultVoice: '',
    instructionModels: [],
    customVoice: true,
    voiceHint: 'Fish Audio Reference ID'
  },
  {
    id: 'gradium',
    label: 'Gradium',
    apiKeyUrl: 'https://gradium.ai/',
    models: [{ id: 'default', label: 'Default' }],
    voices: [],
    defaultModel: 'default',
    defaultVoice: '',
    instructionModels: [],
    customVoice: true,
    voiceHint: 'Gradium Voice ID'
  },
  {
    id: 'hume',
    label: 'Hume',
    apiKeyUrl: 'https://app.hume.ai/keys',
    models: [
      { id: 'octave-2', label: 'Octave 2' },
      { id: 'octave-1', label: 'Octave 1' }
    ],
    voices: [{ id: 'Kora', label: 'Kora' }],
    defaultModel: 'octave-2',
    defaultVoice: 'Kora',
    instructionModels: [],
    customVoice: true,
    voiceHint: 'Hume Voice Name / ID'
  },
  {
    id: 'inworld',
    label: 'Inworld',
    apiKeyUrl: 'https://platform.inworld.ai/api-keys',
    models: [
      { id: 'inworld-tts-1.5-max', label: 'TTS 1.5 Max' },
      { id: 'inworld-tts-1.5-mini', label: 'TTS 1.5 Mini' },
      { id: 'inworld-tts-2', label: 'TTS 2' }
    ],
    voices: [],
    defaultModel: 'inworld-tts-1.5-mini',
    defaultVoice: '',
    instructionModels: [],
    customVoice: true,
    voiceHint: 'Inworld Voice ID'
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    apiKeyUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key',
    models: [
      { id: 'speech-2.8-hd', label: 'Speech 2.8 HD' },
      { id: 'speech-2.8-turbo', label: 'Speech 2.8 Turbo' }
    ],
    voices: [{ id: 'Wise_Woman', label: 'Wise Woman' }],
    defaultModel: 'speech-2.8-turbo',
    defaultVoice: 'Wise_Woman',
    instructionModels: [],
    customVoice: true,
    voiceHint: 'MiniMax Voice ID'
  },
  {
    id: 'doubao',
    label: '豆包语音',
    apiKeyUrl: DOUBAO_TTS_API_KEYS_URL,
    models: [
      { id: 'seed-tts-2.0', label: 'TTS2.0 - 默认音色' },
      { id: 'seed-icl-2.0', label: 'TTS2.0 - 复刻音色' },
      { id: 'seed-tts-1.0', label: 'TTS1.0（速度慢，不推荐）' }
    ],
    voices: [],
    defaultModel: 'seed-tts-2.0',
    defaultVoice: '',
    instructionModels: [],
    customVoice: true,
    voiceHint: '豆包语音 voice_type / Speaker ID'
  },
  {
    id: 'mistral',
    label: 'Mistral',
    apiKeyUrl: 'https://console.mistral.ai/api-keys/',
    models: [{ id: 'voxtral-mini-tts-2603', label: 'Voxtral Mini TTS 2603' }],
    voices: [],
    defaultModel: 'voxtral-mini-tts-2603',
    defaultVoice: '',
    instructionModels: [],
    customVoice: true,
    voiceHint: 'Mistral Voice ID'
  },
  {
    id: 'murf',
    label: 'Murf',
    apiKeyUrl: 'https://murf.ai/api/dashboard',
    models: [
      { id: 'GEN2', label: 'GEN2' },
      { id: 'FALCON', label: 'FALCON' }
    ],
    voices: [],
    defaultModel: 'GEN2',
    defaultVoice: '',
    instructionModels: [],
    customVoice: true,
    voiceHint: 'Murf Voice ID'
  },
  {
    id: 'resemble',
    label: 'Resemble AI',
    apiKeyUrl: 'https://app.resemble.ai/account/api',
    models: [{ id: 'default', label: 'Default' }],
    voices: [],
    defaultModel: 'default',
    defaultVoice: '',
    instructionModels: [],
    customVoice: true,
    voiceHint: 'Resemble Voice UUID'
  },
  {
    id: 'smallestai',
    label: 'Smallest AI',
    apiKeyUrl: 'https://app.smallest.ai/dashboard/api-keys',
    models: [
      { id: 'lightning_v3.1', label: 'Lightning v3.1' },
      { id: 'lightning_v3.1_pro', label: 'Lightning v3.1 Pro' }
    ],
    voices: [
      { id: 'magnus', label: 'Magnus' },
      { id: 'meher', label: 'Meher' }
    ],
    defaultModel: 'lightning_v3.1',
    defaultVoice: 'magnus',
    instructionModels: [],
    customVoice: true,
    voiceHint: 'Smallest AI Voice ID'
  },
  {
    id: 'speechify',
    label: 'Speechify',
    apiKeyUrl: 'https://console.sws.speechify.com/',
    models: [
      { id: 'simba-english', label: 'Simba English' },
      { id: 'simba-3.0', label: 'Simba 3.0' },
      { id: 'simba-multilingual', label: 'Simba Multilingual' }
    ],
    voices: [],
    defaultModel: 'simba-multilingual',
    defaultVoice: '',
    instructionModels: [],
    customVoice: true,
    voiceHint: 'Speechify Voice ID'
  },
  {
    id: 'xai',
    label: 'xAI',
    apiKeyUrl: 'https://console.x.ai/team/default/api-keys',
    models: [{ id: 'grok-tts', label: 'Grok TTS' }],
    voices: [],
    defaultModel: 'grok-tts',
    defaultVoice: '',
    instructionModels: [],
    customVoice: true,
    voiceHint: 'xAI Voice ID'
  }
] as const;

const recommendedSpeechSdkProviderIds: readonly SpeechSdkProviderId[] = [
  'microsoft',
  'gpt-sovits',
  'doubao',
  'elevenlabs',
  'fish'
];

export const disabledSpeechSdkProviderOption = getSpeechSdkProviderOption('none');

export const recommendedSpeechSdkProviderOptions: readonly SpeechSdkProviderOption[] =
  recommendedSpeechSdkProviderIds.map((provider) => getSpeechSdkProviderOption(provider));

export const otherSpeechSdkProviderOptions: readonly SpeechSdkProviderOption[] = speechSdkProviderOptions
  .filter((option) => option.id !== 'none' && !recommendedSpeechSdkProviderIds.includes(option.id))
  .sort((left, right) => left.label.localeCompare(right.label, 'en', { sensitivity: 'base' }));

export function getSpeechSdkProviderOption(provider: SpeechSdkProviderId): SpeechSdkProviderOption {
  return speechSdkProviderOptions.find((option) => option.id === provider) ?? speechSdkProviderOptions[0];
}

export function getDoubaoVoiceConsoleEntry(model: string): { href: string; label: string } {
  if (model === 'seed-icl-2.0') {
    return { href: DOUBAO_TTS_CLONE_URL, label: '前往豆包控制台复刻音色并获取 Voice ID ↗' };
  }
  if (model === 'seed-tts-1.0') {
    return { href: DOUBAO_TTS_VOICES_URL, label: '前往豆包控制台查看 TTS1.0 音色 Voice ID ↗' };
  }
  return { href: DOUBAO_TTS_VOICES_URL, label: '前往豆包控制台获取 TTS2.0 默认音色 Voice ID ↗' };
}

/** True when `model` is one of the provider's built-in presets. */
export function isPresetSpeechSdkModel(provider: SpeechSdkProviderId, model: string): boolean {
  return getSpeechSdkProviderOption(provider).models.some((item) => item.id === model);
}

export function speechSdkModelSupportsInstructions(config: SpeechSdkTtsProviderConfig): boolean {
  const option = getSpeechSdkProviderOption(config.provider);
  // `instructionModels` only ever lists presets, so a hand-typed model id would
  // never match it. Judge those at provider level: if the provider has any
  // instruction-capable model, keep the field instead of silently dropping the
  // instruction text the user already wrote.
  if (!isPresetSpeechSdkModel(config.provider, config.model)) return option.instructionModels.length > 0;
  return option.instructionModels.includes(config.model);
}

export function getSpeechSdkCustomVoiceValue(provider: SpeechSdkProviderId, voice: string): string {
  const option = getSpeechSdkProviderOption(provider);
  const trimmedVoice = voice.trim();
  if (!option.customVoice || !trimmedVoice) return '';
  return option.voices.some((item) => item.id === trimmedVoice) ? '' : trimmedVoice;
}

export function getTtsProviderKind(
  provider: SpeechSdkProviderId
): 'disabled' | 'local' | 'gpt-sovits' | 'speech-sdk' {
  return getSpeechSdkProviderOption(provider).kind ?? 'speech-sdk';
}
