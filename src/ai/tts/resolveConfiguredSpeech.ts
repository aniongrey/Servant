import { loadSpeechSdkTtsConfig } from './speechSdkTtsConfig';
import { translateWithMyMemory } from './MyMemoryTranslator';

/** Fixed character lines use the same independent translator as conversation TTS adaptation. */
export async function resolveConfiguredSpeech(text: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const config = loadSpeechSdkTtsConfig();
  if (!config.ttsTranslationEnabled || config.ttsLanguage === 'zh') return text;
  try {
    const translated = await translateWithMyMemory(text, config.ttsLanguage, signal);
    signal?.throwIfAborted();
    return translated.trim() || text;
  } catch {
    signal?.throwIfAborted();
    return text;
  }
}
