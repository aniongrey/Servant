import { loadVoiceLibrary } from './localVoiceLibrary';
import { getSpeechSdkConfigForProvider, loadSpeechSdkTtsConfig } from './speechSdkTtsConfig';

/** An explicit role voice must never silently turn into the global system voice. */
export function loadCharacterVoiceConfig(voiceId: string) {
  if (!voiceId) return loadSpeechSdkTtsConfig();
  const voice = loadVoiceLibrary().find((entry) => entry.id === voiceId);
  if (!voice) throw new Error(`角色关联音色已不存在：${voiceId}，请在角色设置中重新选择音色`);
  return {
    ...getSpeechSdkConfigForProvider(voice.provider),
    provider: voice.provider,
    model: voice.model,
    voice: voice.voice
  };
}

/** Match the voice-only playback fallback when a character's saved voice is stale. */
export function loadCharacterVoiceConfigOrDefault(voiceId: string) {
  try {
    return loadCharacterVoiceConfig(voiceId);
  } catch {
    return loadSpeechSdkTtsConfig();
  }
}
