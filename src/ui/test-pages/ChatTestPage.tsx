import { useEffect, useMemo, useState } from 'react';
import { createAgentRuntime } from '../../ai/AgentRuntime';
import { CompanionChatPanel } from '../chat/CompanionChatPanel';
import { getActiveSpeechSdkTtsLanguage, loadSpeechSdkTtsConfig } from '../../ai/tts/speechSdkTtsConfig';
import { createActiveTtsProvider } from '../../ai/tts/createActiveTtsProvider';
import { resolveTtsEmotionMarkup } from '../../ai/tts/ttsEmotionMarkup';
import { createGlobalNetworkFetch } from '../../app/network/globalNetworkFetch';
import { createBrowserSoulManager } from '../../character/state';
import { loadCharacterSkill, pendingCharacterSkill } from '../../ai/personality/CharacterSkill';
import { loadLlmConfig, type LlmConfig } from '../../ai/llm/LlmConfig';
import {
  listenDesktopRealtimeSync,
  publishDesktopRealtimeSync
} from '../../app/network/realtime/DesktopRealtimeSync';
import {
  createDefaultReminderJobStore,
  DesktopReminderScheduler
} from '../../desktop/tauri/DesktopReminderScheduler';
import { isTauriDesktop } from '../../desktop/tauri/navigation';

const PROXY_ENABLED_KEY = 'codex-list.globalProxyEnabled.v1';
const PROXY_URL_KEY = 'codex-list.globalProxyUrl.v1';

export function ChatTestPage() {
  const [ttsConfig, setTtsConfig] = useState(loadSpeechSdkTtsConfig);
  const [llmConfig, setLlmConfig] = useState<LlmConfig>(loadLlmConfig);
  const networkFetch = useMemo(
    () =>
      createGlobalNetworkFetch({
        proxyEnabled: localStorage.getItem(PROXY_ENABLED_KEY) === 'true',
        proxyUrl: localStorage.getItem(PROXY_URL_KEY) ?? ''
      }),
    []
  );
  const ttsProvider = useMemo(
    () => createActiveTtsProvider(ttsConfig, networkFetch),
    [networkFetch, ttsConfig]
  );
  const [characterSkill, setCharacterSkill] = useState(pendingCharacterSkill);
  useEffect(() => {
    // Drives the soul manager's storage key only; the panel loads its own copy.
    // A rejected load must not surface as an unhandled rejection.
    void loadCharacterSkill()
      .then(setCharacterSkill)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    // The desktop window owns scheduling in Tauri; standalone chat pages need
    // the same local executor so scheduler commands do not wait for desktop.html.
    if (isTauriDesktop()) return;
    const scheduler = new DesktopReminderScheduler(
      createDefaultReminderJobStore(),
      publishDesktopRealtimeSync,
      Date.now,
      console.error,
      publishDesktopRealtimeSync
    );
    const unsubscribe = listenDesktopRealtimeSync((event) => void scheduler.handle(event));
    void scheduler.start().catch(console.error);
    return () => {
      unsubscribe();
      scheduler.dispose();
    };
  }, []);
  const characterStateManager = useMemo(
    () => createBrowserSoulManager(characterSkill.config.id),
    [characterSkill]
  );
  const engine = useMemo(
    () => createAgentRuntime({ ttsProvider, characterStateManager }),
    [characterStateManager, ttsProvider]
  );
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (
        !event.key ||
        event.key.startsWith('codex-list.ttsConfig.') ||
        event.key === 'codex-list.ttsTranslationConfig.v1'
      )
        setTtsConfig(loadSpeechSdkTtsConfig());
      if (!event.key || event.key === 'codex-list.llmConfig.v2') setLlmConfig(loadLlmConfig());
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);
  return (
    <main className="module-test-page chat-test-page">
      <section className="chat-test-shell">
        <CompanionChatPanel
          engine={engine}
          llmConfig={llmConfig}
          networkFetch={networkFetch}
          onLlmConfigChange={setLlmConfig}
          ttsLanguage={getActiveSpeechSdkTtsLanguage(ttsConfig)}
          ttsEmotionMarkup={resolveTtsEmotionMarkup(ttsConfig)}
        />
      </section>
    </main>
  );
}
