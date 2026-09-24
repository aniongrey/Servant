import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultSpeechSdkConfigForProvider,
  getActiveSpeechSdkTtsLanguage,
  getSpeechSdkConfigForProvider,
  isSpeechSdkTtsConfigComplete,
  loadSpeechSdkTtsConfig,
  normalizeSpeechSdkTtsProviderConfig,
  saveSpeechSdkTtsConfig,
  TTS_TRANSLATION_CONFIG_STORAGE_KEY
} from './speechSdkTtsConfig';
import {
  DOUBAO_TTS_API_KEYS_URL,
  getDoubaoVoiceConsoleEntry,
  getSpeechSdkCustomVoiceValue,
  getSpeechSdkProviderOption,
  isPresetSpeechSdkModel,
  otherSpeechSdkProviderOptions,
  recommendedSpeechSdkProviderOptions,
  speechSdkModelSupportsInstructions,
  speechSdkProviderOptions
} from './speechSdkProviderOptions';

describe('speechSdkProviderOptions', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() {
        return values.size;
      }
    } satisfies Storage);
  });

  it('only enables Speech SDK preview for complete cloud configuration', () => {
    const config = createDefaultSpeechSdkConfigForProvider('openai');
    expect(isSpeechSdkTtsConfigComplete(config)).toBe(false);
    expect(isSpeechSdkTtsConfigComplete({ ...config, apiKey: 'test-key' })).toBe(true);
    expect(isSpeechSdkTtsConfigComplete(createDefaultSpeechSdkConfigForProvider('microsoft'))).toBe(true);
    expect(isSpeechSdkTtsConfigComplete(createDefaultSpeechSdkConfigForProvider('none'))).toBe(false);
  });

  it('offers disabled and local modes before every Speech SDK provider', () => {
    expect(speechSdkProviderOptions.map((option) => option.id)).toEqual([
      'none',
      'microsoft',
      'gpt-sovits',
      'openai',
      'elevenlabs',
      'deepgram',
      'google',
      'cartesia',
      'fal',
      'fish',
      'gradium',
      'hume',
      'inworld',
      'minimax',
      'doubao',
      'mistral',
      'murf',
      'resemble',
      'smallestai',
      'speechify',
      'xai'
    ]);
    expect(
      speechSdkProviderOptions
        .filter((option) => option.kind !== 'disabled')
        .every((option) => option.models.length > 0)
    ).toBe(true);
    expect(
      speechSdkProviderOptions
        .filter((option) => !option.kind)
        .every((option) => option.voices.length > 0 || option.customVoice)
    ).toBe(true);
    expect(
      speechSdkProviderOptions
        .filter((option) => !option.kind)
        .every((option) => option.apiKeyUrl?.startsWith('https://'))
    ).toBe(true);
  });

  it('groups recommended providers and alphabetizes every other enabled provider', () => {
    expect(recommendedSpeechSdkProviderOptions.map((option) => option.id)).toEqual([
      'microsoft',
      'gpt-sovits',
      'doubao',
      'elevenlabs',
      'fish'
    ]);
    expect(otherSpeechSdkProviderOptions.map((option) => option.label)).toEqual([
      'Cartesia',
      'Deepgram',
      'fal.ai',
      'Google Gemini',
      'Gradium',
      'Hume',
      'Inworld',
      'MiniMax',
      'Mistral',
      'Murf',
      'OpenAI',
      'Resemble AI',
      'Smallest AI',
      'Speechify',
      'xAI'
    ]);
  });

  it('creates a complete provider preset', () => {
    expect(createDefaultSpeechSdkConfigForProvider('openai')).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
      apiKey: '',
      appId: '',
      instructions: '',
      speed: 1,
      outputFormat: 'mp3',
      ttsTranslationEnabled: false,
      ttsLanguage: 'ja'
    });
  });

  it('requires an API key for Doubao speech', () => {
    const config = createDefaultSpeechSdkConfigForProvider('doubao');
    expect(getSpeechSdkProviderOption('doubao').models).toEqual([
      { id: 'seed-tts-2.0', label: 'TTS2.0 - 默认音色' },
      { id: 'seed-icl-2.0', label: 'TTS2.0 - 复刻音色' },
      { id: 'seed-tts-1.0', label: 'TTS1.0（速度慢，不推荐）' }
    ]);
    expect(config).toMatchObject({
      provider: 'doubao',
      model: 'seed-tts-2.0',
      voice: ''
    });
    expect(isSpeechSdkTtsConfigComplete({ ...config, apiKey: 'token', voice: 'private-speaker-id' })).toBe(
      true
    );
  });

  it('needs nothing but a role preset for the local GPT-SoVITS provider', () => {
    const config = createDefaultSpeechSdkConfigForProvider('gpt-sovits');
    expect(config.model).toBe('api_v2');
    expect(isSpeechSdkTtsConfigComplete(config)).toBe(false);
    // No API key exists for a local engine, so a key must not "complete" it.
    expect(isSpeechSdkTtsConfigComplete({ ...config, apiKey: 'unused' })).toBe(false);
    expect(isSpeechSdkTtsConfigComplete({ ...config, voice: '白瓜-x1y2' })).toBe(true);
    // The role id is not a preset voice, but it must survive normalization —
    // it is the only thing the provider stores.
    expect(normalizeSpeechSdkTtsProviderConfig({ ...config, voice: '白瓜-x1y2' }).voice).toBe('白瓜-x1y2');
  });

  it('uses distinct Doubao console links for standard and cloned voices', () => {
    expect(getDoubaoVoiceConsoleEntry('seed-tts-2.0')).toMatchObject({
      href: 'https://console.volcengine.com/speech/new/voices?projectName=default',
      label: expect.stringContaining('默认音色')
    });
    expect(getDoubaoVoiceConsoleEntry('seed-icl-2.0')).toMatchObject({
      href: 'https://console.volcengine.com/speech/new/experience/clone?projectName=default',
      label: expect.stringContaining('复刻音色')
    });
    expect(DOUBAO_TTS_API_KEYS_URL).toBe(
      'https://console.volcengine.com/speech/new/setting/apikeys?projectName=default'
    );
  });

  it('migrates Doubao PCM output to a browser-playable format', () => {
    expect(
      normalizeSpeechSdkTtsProviderConfig({
        ...createDefaultSpeechSdkConfigForProvider('doubao'),
        outputFormat: 'pcm'
      }).outputFormat
    ).toBe('mp3');
  });

  it('shares the configured TTS conversion language with debug conversation', () => {
    const config = createDefaultSpeechSdkConfigForProvider('doubao');
    expect(
      getActiveSpeechSdkTtsLanguage({ ...config, ttsTranslationEnabled: false, ttsLanguage: 'ja' })
    ).toBe('zh');
    expect(getActiveSpeechSdkTtsLanguage({ ...config, ttsTranslationEnabled: true, ttsLanguage: 'ja' })).toBe(
      'ja'
    );
  });

  it('defaults to the local system voice without a separate enable flag', () => {
    expect(normalizeSpeechSdkTtsProviderConfig(undefined)).toMatchObject({
      provider: 'microsoft',
      model: 'system-speech-synthesis',
      voice: ''
    });
    expect(normalizeSpeechSdkTtsProviderConfig(undefined)).not.toHaveProperty('enabled');
  });

  it('gates instructions per preset but keeps them for a hand-typed model', () => {
    const openai = createDefaultSpeechSdkConfigForProvider('openai');
    expect(isPresetSpeechSdkModel('openai', openai.model)).toBe(true);
    expect(speechSdkModelSupportsInstructions(openai)).toBe(true);
    expect(speechSdkModelSupportsInstructions({ ...openai, model: 'tts-1' })).toBe(false);
    // A model typed by hand is not in `instructionModels`, but the provider does
    // support instructions, so the field stays instead of silently disappearing.
    expect(speechSdkModelSupportsInstructions({ ...openai, model: 'gpt-4o-mini-tts-2026' })).toBe(true);
    expect(isPresetSpeechSdkModel('openai', 'gpt-4o-mini-tts-2026')).toBe(false);

    const deepgram = createDefaultSpeechSdkConfigForProvider('deepgram');
    expect(speechSdkModelSupportsInstructions({ ...deepgram, model: 'aura-3' })).toBe(false);
  });

  it('keeps a hand-typed model and still enforces the voice rules', () => {
    const normalized = normalizeSpeechSdkTtsProviderConfig({
      provider: 'google',
      model: 'custom-model',
      voice: 'custom-voice',
      speed: 9
    });
    const preset = getSpeechSdkProviderOption('google');
    // The model field is free text, so an id outside the presets must survive.
    expect(normalized.model).toBe('custom-model');
    expect(normalized.voice).toBe(preset.defaultVoice);
    expect(normalized.speed).toBe(1.5);
  });

  it('falls back to the provider default model only for an empty value', () => {
    const preset = getSpeechSdkProviderOption('google');
    expect(normalizeSpeechSdkTtsProviderConfig({ provider: 'google', model: '   ' }).model).toBe(
      preset.defaultModel
    );
    expect(normalizeSpeechSdkTtsProviderConfig({ provider: 'google', model: '' }).model).toBe(
      preset.defaultModel
    );
  });

  it('keeps account-specific voice ids only for providers that support them', () => {
    expect(
      normalizeSpeechSdkTtsProviderConfig({
        provider: 'cartesia',
        model: 'sonic-3.5',
        voice: 'account-voice-123'
      }).voice
    ).toBe('account-voice-123');
    expect(
      normalizeSpeechSdkTtsProviderConfig({
        provider: 'openai',
        model: 'gpt-4o-mini-tts',
        voice: 'account-voice-123'
      }).voice
    ).toBe('alloy');
  });

  it('preserves custom voice ids where preset voice dropdown and private field overlap', () => {
    expect(getSpeechSdkCustomVoiceValue('elevenlabs', 'JBFqnCBsd6RMkjVDRZzb')).toBe('');
    expect(getSpeechSdkCustomVoiceValue('elevenlabs', 'custom-voice-123')).toBe('custom-voice-123');
    expect(getSpeechSdkCustomVoiceValue('openai', 'alloy')).toBe('');
  });

  it('remembers saved values for a provider when switching providers', () => {
    saveSpeechSdkTtsConfig({
      provider: 'openai',
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
      apiKey: 'open-ai-key',
      appId: '',
      apiBase: 'https://openspeech.bytedance.com/api/v3/tts/create',
      sampleRate: 48000,
      loudnessRate: 0,
      pitchRate: 0,
      timeoutMs: 30000,
      instructions: '',
      speed: 1,
      outputFormat: 'mp3',
      ttsTranslationEnabled: false,
      ttsLanguage: 'ja'
    });
    saveSpeechSdkTtsConfig({
      provider: 'elevenlabs',
      model: 'eleven_v3',
      voice: 'custom-voice-123',
      apiKey: 'eleven-key',
      appId: '',
      apiBase: 'https://openspeech.bytedance.com/api/v3/tts/create',
      sampleRate: 48000,
      loudnessRate: 0,
      pitchRate: 0,
      timeoutMs: 30000,
      instructions: '',
      speed: 1,
      outputFormat: 'mp3',
      ttsTranslationEnabled: false,
      ttsLanguage: 'zh'
    });

    expect(
      getSpeechSdkConfigForProvider('openai', createDefaultSpeechSdkConfigForProvider('openai'))
    ).toMatchObject({
      provider: 'openai',
      apiKey: 'open-ai-key'
    });
    expect(loadSpeechSdkTtsConfig()).toMatchObject({
      provider: 'elevenlabs',
      apiKey: 'eleven-key'
    });
  });

  it('keeps language conversion independent from the selected TTS provider', () => {
    saveSpeechSdkTtsConfig({
      ...createDefaultSpeechSdkConfigForProvider('doubao'),
      apiKey: 'doubao-key',
      voice: 'doubao-voice',
      ttsTranslationEnabled: true,
      ttsLanguage: 'ja'
    });

    const openAiConfig = getSpeechSdkConfigForProvider(
      'openai',
      createDefaultSpeechSdkConfigForProvider('openai')
    );
    expect(openAiConfig).toMatchObject({
      provider: 'openai',
      ttsTranslationEnabled: true,
      ttsLanguage: 'ja'
    });

    saveSpeechSdkTtsConfig({ ...openAiConfig, ttsTranslationEnabled: false, ttsLanguage: 'en' });
    expect(
      getSpeechSdkConfigForProvider('doubao', createDefaultSpeechSdkConfigForProvider('doubao'))
    ).toMatchObject({
      provider: 'doubao',
      ttsTranslationEnabled: false,
      ttsLanguage: 'en'
    });
    expect(JSON.parse(localStorage.getItem(TTS_TRANSLATION_CONFIG_STORAGE_KEY) ?? '{}')).toEqual({
      ttsTranslationEnabled: false,
      ttsLanguage: 'en'
    });
  });
});
