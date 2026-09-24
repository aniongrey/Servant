import { createActiveTtsProvider } from '../../ai/tts/createActiveTtsProvider';
import { useState, useMemo, useEffect, useRef } from 'react';
import { type SpeechSdkTtsProviderConfig, type SpeechSdkProviderId } from '../../ai/tts/speechSdkTypes';
import {
  loadSpeechSdkTtsConfig,
  saveSpeechSdkTtsConfig,
  normalizeSpeechSdkTtsProviderConfig,
  getSpeechSdkConfigForProvider,
  createDefaultSpeechSdkConfigForProvider,
  isSpeechSdkTtsConfigComplete
} from '../../ai/tts/speechSdkTtsConfig';
import {
  getSpeechSdkProviderOption,
  getTtsProviderKind,
  getSpeechSdkCustomVoiceValue
} from '../../ai/tts/speechSdkProviderOptions';
import {
  loadGlobalProxyEnabled,
  loadGlobalProxyUrl,
  loadWebSearchEnabled,
  saveGlobalProxyEnabled,
  saveGlobalProxyUrl,
  saveWebSearchEnabled
} from './debugSettings';
import { createGlobalNetworkFetch } from '../../app/network/globalNetworkFetch';
import { type AgentRuntime } from '../../ai/AgentRuntime';
import { loadWebSearchEnabled as loadWebSearchEnabledApi } from '../../app/network/webSearchSettings';
import { resolveTtsPreviewText } from '../../ai/tts/TtsPreviewText';
import { translateWithMyMemory } from '../../ai/tts/MyMemoryTranslator';

export function useDebugSpeechSettings(engine: AgentRuntime) {
  const [speechSdkConfig, setSpeechSdkConfig] = useState<SpeechSdkTtsProviderConfig>(loadSpeechSdkTtsConfig);

  const speechSdkProvider = getSpeechSdkProviderOption(speechSdkConfig.provider);

  const speechSdkProviderKind = getTtsProviderKind(speechSdkConfig.provider);

  const speechSdkVoiceIsPreset = speechSdkProvider.voices.some(
    (option) => option.id === speechSdkConfig.voice
  );

  const speechSdkCustomVoiceValue = getSpeechSdkCustomVoiceValue(
    speechSdkConfig.provider,
    speechSdkConfig.voice
  );

  const [globalProxyEnabled, setGlobalProxyEnabled] = useState(loadGlobalProxyEnabled);

  const [globalProxyUrl, setGlobalProxyUrl] = useState(loadGlobalProxyUrl);

  const [webSearchEnabled, setWebSearchEnabled] = useState(loadWebSearchEnabled);

  const networkFetch = useMemo(
    () => createGlobalNetworkFetch({ proxyEnabled: globalProxyEnabled, proxyUrl: globalProxyUrl }),
    [globalProxyEnabled, globalProxyUrl]
  );

  const activeTtsProvider = useMemo(
    () => createActiveTtsProvider(speechSdkConfig, networkFetch),
    [networkFetch, speechSdkConfig]
  );

  const [speechSdkSettingsError, setSpeechSdkSettingsError] = useState('');

  const [speechSdkTestText, setSpeechSdkTestText] = useState('你好，我正在使用 Speech SDK。');
  const previewRequestRef = useRef<AbortController | null>(null);

  useEffect(() => () => previewRequestRef.current?.abort(), [engine, speechSdkConfig, networkFetch]);

  useEffect(() => {
    saveSpeechSdkTtsConfig(speechSdkConfig);
  }, [speechSdkConfig]);

  useEffect(() => {
    saveGlobalProxyEnabled(globalProxyEnabled);
  }, [globalProxyEnabled]);

  useEffect(() => {
    saveGlobalProxyUrl(globalProxyUrl);
  }, [globalProxyUrl]);

  useEffect(() => {
    saveWebSearchEnabled(webSearchEnabled);
  }, [webSearchEnabled]);

  useEffect(() => {
    let disposed = false;
    void loadWebSearchEnabledApi(webSearchEnabled).then((enabled) => {
      if (!disposed) setWebSearchEnabled(enabled);
    });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    engine.tts.setProvider(activeTtsProvider);
  }, [activeTtsProvider, engine]);

  const updateSpeechSdkConfig = (patch: Partial<SpeechSdkTtsProviderConfig>) => {
    setSpeechSdkConfig((current) => normalizeSpeechSdkTtsProviderConfig({ ...current, ...patch }));
    setSpeechSdkSettingsError('');
  };

  const selectSpeechSdkProvider = (providerId: SpeechSdkProviderId) => {
    const nextConfig = getSpeechSdkConfigForProvider(
      providerId,
      speechSdkConfig.provider === providerId
        ? speechSdkConfig
        : createDefaultSpeechSdkConfigForProvider(providerId)
    );
    setSpeechSdkConfig(nextConfig);
    setSpeechSdkSettingsError('');
  };

  const resetSpeechSdkConfig = () => {
    const nextConfig = {
      ...createDefaultSpeechSdkConfigForProvider(speechSdkConfig.provider),
      ttsTranslationEnabled: speechSdkConfig.ttsTranslationEnabled,
      ttsLanguage: speechSdkConfig.ttsLanguage
    };
    setSpeechSdkConfig(nextConfig);
    setSpeechSdkSettingsError('');
  };

  const testSpeechSdkVoice = async () => {
    previewRequestRef.current?.abort();
    setSpeechSdkSettingsError('');
    if (!isSpeechSdkTtsConfigComplete(speechSdkConfig)) {
      setSpeechSdkSettingsError('TTS 配置不完整，请检查 API Key、模型和音色。');
      return;
    }
    const controller = new AbortController();
    previewRequestRef.current = controller;
    try {
      const previewText = await resolveTtsPreviewText(
        speechSdkTestText,
        speechSdkConfig,
        (speech, language, signal) =>
          translateWithMyMemory(speech, language, signal),
        controller.signal
      );
      if (controller.signal.aborted) return;
      await engine.speech.sayText(previewText, { intent: 'settings_tts_test', signal: controller.signal });
    } catch (cause) {
      if (controller.signal.aborted) return;
      setSpeechSdkSettingsError(cause instanceof Error ? cause.message : 'Speech SDK 试听失败。');
    }
  };

  return {
    speechSdkConfig,
    speechSdkProvider,
    speechSdkProviderKind,
    speechSdkVoiceIsPreset,
    speechSdkCustomVoiceValue,
    globalProxyEnabled,
    setGlobalProxyEnabled,
    globalProxyUrl,
    setGlobalProxyUrl,
    networkFetch,
    activeTtsProvider,
    speechSdkSettingsError,
    speechSdkTestText,
    setSpeechSdkTestText,
    updateSpeechSdkConfig,
    selectSpeechSdkProvider,
    resetSpeechSdkConfig,
    testSpeechSdkVoice
  };
}

export type DebugSpeechSettings = ReturnType<typeof useDebugSpeechSettings>;
