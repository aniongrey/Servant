import { useEffect, useMemo, useState } from 'react';
import { createGlobalNetworkFetch } from '../../app/network/globalNetworkFetch';
import {
  GLOBAL_PROXY_ENABLED_STORAGE_KEY,
  GLOBAL_PROXY_URL_STORAGE_KEY,
  UI_PREFERENCES_STORAGE_KEY
} from '../../app/settings/storageKeys';
import { loadUiPreferences } from '../../app/settings/uiPreferences';
import { useStorageRevision } from '../../app/settings/useStorageRevision';
import { DisabledTtsProvider } from '../../ai/tts/DisabledTtsProvider';
import {
  loadSpeechSdkTtsConfig,
  SPEECH_SDK_TTS_CONFIG_STORAGE_KEY,
  SPEECH_SDK_TTS_PROVIDER_CONFIGS_STORAGE_KEY,
  TTS_TRANSLATION_CONFIG_STORAGE_KEY
} from '../../ai/tts/speechSdkTtsConfig';
import type { TtsProvider } from '../../ai/tts/types';
import { VOICE_SETTINGS_STORAGE_KEY } from '../../ai/voice/VoiceSettings';

/** Keeps the desktop renderer on the same saved TTS and proxy settings as chat/debug. */
export function useDesktopTtsProvider() {
  const settingsRevision = useStorageRevision(isDesktopTtsStorageKey);

  const preferences = useMemo(loadUiPreferences, [settingsRevision]);
  const config = useMemo(loadSpeechSdkTtsConfig, [settingsRevision]);
  const networkFetch = useMemo(
    () =>
      createGlobalNetworkFetch({
        proxyEnabled: preferences.proxyEnabled,
        proxyUrl: preferences.proxyUrl
      }),
    [preferences.proxyEnabled, preferences.proxyUrl]
  );
  const [provider, setProvider] = useState<TtsProvider>(() => new DisabledTtsProvider());

  useEffect(() => {
    let disposed = false;
    void import('../../ai/tts/createActiveTtsProvider')
      .then(({ createActiveTtsProvider }) => {
        const next = createActiveTtsProvider(config, networkFetch);
        if (disposed) next.cancel();
        else setProvider(next);
      })
      .catch((error) => console.error('Unable to load desktop TTS provider', error));
    return () => {
      disposed = true;
    };
  }, [config, networkFetch]);

  useEffect(() => () => provider.cancel(), [provider]);
  return provider;
}

function isDesktopTtsStorageKey(key: string | null): boolean {
  return (
    key === null ||
    key === SPEECH_SDK_TTS_CONFIG_STORAGE_KEY ||
    key === SPEECH_SDK_TTS_PROVIDER_CONFIGS_STORAGE_KEY ||
    key === TTS_TRANSLATION_CONFIG_STORAGE_KEY ||
    key === VOICE_SETTINGS_STORAGE_KEY ||
    key?.startsWith('codex-list.ttsConfig.provider.') === true ||
    key === GLOBAL_PROXY_ENABLED_STORAGE_KEY ||
    key === GLOBAL_PROXY_URL_STORAGE_KEY ||
    key === UI_PREFERENCES_STORAGE_KEY
  );
}
