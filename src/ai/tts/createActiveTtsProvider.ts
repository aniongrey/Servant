import { BrowserSpeechSynthesisProvider } from './BrowserSpeechSynthesisProvider';
import { DisabledTtsProvider } from './DisabledTtsProvider';
import { GptSovitsTtsProvider } from './GptSovitsTtsProvider';
import { SpeechSdkTtsProvider } from './SpeechSdkTtsProvider';
import { type SpeechSdkTtsProviderConfig } from './speechSdkTypes';
import type { TtsProvider } from './types';

export function createActiveTtsProvider(
  config: SpeechSdkTtsProviderConfig,
  networkFetch: typeof globalThis.fetch = globalThis.fetch
): TtsProvider {
  if (config.provider === 'none') return new DisabledTtsProvider();
  if (config.provider === 'microsoft') {
    return new BrowserSpeechSynthesisProvider(undefined, undefined, 'Microsoft', config.speed);
  }
  if (config.provider === 'gpt-sovits') return new GptSovitsTtsProvider(config);
  return new SpeechSdkTtsProvider(config, { fetch: networkFetch });
}
