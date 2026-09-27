import { afterEach, expect, it, vi } from 'vitest';
import { loadCharacterVoiceConfig } from './characterVoiceConfig';
import { TTS_VOICE_LIBRARY_STORAGE_KEY } from './localVoiceLibrary';
import { SPEECH_SDK_TTS_CONFIG_STORAGE_KEY } from './speechSdkTtsConfig';

afterEach(() => vi.unstubAllGlobals());

it('uses the selected voice provider credentials and refuses stale voice bindings', () => {
  const settings: Record<string, string> = {
    [SPEECH_SDK_TTS_CONFIG_STORAGE_KEY]: JSON.stringify({ provider: 'microsoft' }),
    'codex-list.ttsConfig.provider.openai': JSON.stringify({
      provider: 'openai', apiKey: 'role-provider-key', model: 'tts-1', voice: 'alloy'
    }),
    [TTS_VOICE_LIBRARY_STORAGE_KEY]: JSON.stringify([{
      id: 'role-voice', name: '角色音色', provider: 'openai', model: 'tts-1', voice: 'nova',
      createdAt: 1, updatedAt: 1
    }])
  };
  vi.stubGlobal('localStorage', { getItem: (key: string) => settings[key] ?? null });
  expect(loadCharacterVoiceConfig('')).toMatchObject({ provider: 'microsoft' });
  expect(loadCharacterVoiceConfig('role-voice')).toMatchObject({
    provider: 'openai', apiKey: 'role-provider-key', voice: 'nova'
  });
  expect(() => loadCharacterVoiceConfig('deleted-voice')).toThrow('角色关联音色已不存在');
});
