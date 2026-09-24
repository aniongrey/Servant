import { useCallback, useEffect, useMemo, useState } from 'react';
import { Square } from 'lucide-react';
import { VrmStage } from '../../character/vrm/VrmStage';
import type { CharacterController } from '../../character/CharacterController';
import { useDesktopCharacter } from '../../desktop/tauri/useDesktopCharacter';
import { loadDesktopTestSettings, withTestModules, type TestModules } from './testSettings';
import { CompanionChatPanel } from '../chat/CompanionChatPanel';
import { getActiveSpeechSdkTtsLanguage, loadSpeechSdkTtsConfig } from '../../ai/tts/speechSdkTtsConfig';
import { createActiveTtsProvider } from '../../ai/tts/createActiveTtsProvider';
import { resolveTtsEmotionMarkup } from '../../ai/tts/ttsEmotionMarkup';
import { createGlobalNetworkFetch } from '../../app/network/globalNetworkFetch';
import { createBrowserSoulManager } from '../../character/state';
import { loadCharacterSkill, pendingCharacterSkill } from '../../ai/personality/CharacterSkill';
import type { RuntimeSnapshot } from '../../app/runtimeTypes';
import { nativeExpressionIds } from '../../character/expression/ExpressionController';
import microConfig from '../../character/micro-dynamics/micro-dynamics.json';

const PROXY_ENABLED_KEY = 'codex-list.globalProxyEnabled.v1';
const PROXY_URL_KEY = 'codex-list.globalProxyUrl.v1';
const emotionOptions = nativeExpressionIds;

export function CharacterTestPage() {
  const { modelUrl, error, settings: desktopSettings } = useDesktopCharacter();
  const baseSettings = useMemo(loadDesktopTestSettings, []);
  const [modules, setModules] = useState<TestModules>(() => ({
    avatarFit: true,
    hold: baseSettings.holdMicroMotionEnabled,
    footIk: baseSettings.footIkEnabled,
    handIk: baseSettings.avatarFit.handIk.enabled,
    lighting:
      baseSettings.renderConfig.mainLightIntensity > 0 || baseSettings.renderConfig.ambientLightIntensity > 0
  }));
  const settings = withTestModules(baseSettings, modules);
  const [status, setStatus] = useState(error ?? '正在加载角色模块…');
  const [engine, setEngine] = useState<CharacterController | null>(null);
  const ttsConfig = useMemo(loadSpeechSdkTtsConfig, []);
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
    void loadCharacterSkill().then(setCharacterSkill);
  }, []);
  const characterStateManager = useMemo(
    () => createBrowserSoulManager(characterSkill.config.id),
    [characterSkill]
  );
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const actions = engine?.actionLoader.listActions() ?? [];
  const updateModule = useCallback(
    (key: keyof TestModules, checked: boolean) => setModules((current) => ({ ...current, [key]: checked })),
    []
  );
  const handleEngineReady = useCallback((next: CharacterController) => {
    setEngine(next);
    setStatus('角色模块已加载');
  }, []);
  useEffect(() => {
    if (error) setStatus(error);
  }, [error]);
  useEffect(
    () => (engine ? engine.store.subscribe(() => setSnapshot(engine.store.getSnapshot())) : undefined),
    [engine]
  );
  const emotions = actions.filter((action) => action.state === 'emotion');
  const casual = actions.filter((action) => action.state === 'casual');
  const idle = actions.filter((action) => action.state === 'idle');
  const playExpression = (emotion: (typeof emotionOptions)[number]) => {
    void engine?.expression.set(emotion, 1);
  };

  return (
    <main className="module-test-page">
      <header className="module-test-header">
        <div>
          <span className="eyebrow">CHARACTER MODULE TEST</span>
          <h1>角色测试 · V1 全身动作</h1>
          <p>Emotion 按用途组合切分 VRMA、原生表情与微动作；组合配置在 VRMA 编辑台管理。</p>
        </div>
        <span className="module-test-status">{status}</span>
      </header>
      <section className="module-test-grid">
        <div className="module-test-stage">
          <VrmStage
            modelUrl={modelUrl}
            ttsProvider={ttsProvider}
            characterStateManager={characterStateManager}
            avatarFitConfig={
              modules.avatarFit
                ? settings.avatarFit
                : {
                    ...settings.avatarFit,
                    showGuide: false,
                    handIk: { ...settings.avatarFit.handIk, enabled: false }
                  }
            }
            holdMicroMotionEnabled={settings.holdMicroMotionEnabled}
            footIkEnabled={settings.footIkEnabled}
            renderConfig={settings.renderConfig}
            proportionConfig={desktopSettings.proportionConfig}
            onEngineReady={handleEngineReady}
            onStatus={setStatus}
          />
        </div>
        <div className="module-test-panel">
          <h2>桌面端模块开关</h2>
          {(
            [
              ['avatarFit', 'AvatarFit 拟合'],
              ['hold', 'Hold 微动作'],
              ['footIk', '脚步 IK'],
              ['handIk', '手部 IK'],
              ['lighting', '光线']
            ] as const
          ).map(([key, label]) => (
            <label className="module-test-toggle" key={key}>
              <span>
                {label}
                <small>{modules[key] ? '已启用' : '已关闭'}</small>
              </span>
              <input
                type="checkbox"
                checked={modules[key]}
                onChange={(event) => updateModule(key, event.currentTarget.checked)}
              />
            </label>
          ))}
          <p className="module-test-note">初始值来自设置页；切换只用于运行时加载验证，不会保存。</p>
        </div>
      </section>
      <section className="character-test-tools">
        <div className="module-test-panel">
          <h2>动作调试</h2>
          <h3>待机动作（逐个测试）</h3>
          <div className="motion-debug-buttons">
            {idle.map((action) => (
              <button
                type="button"
                disabled={!engine}
                key={action.id}
                onClick={() => void engine?.actionRuntime.play([action.id])}
              >
                {action.id}
              </button>
            ))}
          </div>
          <h3>情绪 / 闲动作</h3>
          <div className="motion-debug-buttons">
            {[...emotions, ...casual].map((action) => (
              <button
                type="button"
                disabled={!engine}
                key={action.id}
                onClick={() =>
                  action.state === 'emotion'
                    ? engine?.actions.playEmotion(action.id)
                    : engine?.actionRuntime.play([action.id])
                }
              >
                {action.id}
              </button>
            ))}
          </div>
          <h3>VRM 标准表情</h3>
          <a href="/vrma-editor">编辑 emotion 组合与说话填充</a>
          <div className="motion-debug-buttons">
            {emotionOptions.map((emotion) => (
              <button type="button" disabled={!engine} key={emotion} onClick={() => playExpression(emotion)}>
                {emotion}
              </button>
            ))}
            {microConfig.actions.map((action) => (
              <button
                type="button"
                key={action.id}
                disabled={!engine}
                onClick={() => engine?.microdynamics.play(action.id)}
              >
                {action.label}
              </button>
            ))}
          </div>
          <div className="motion-debug-status">
            状态：{snapshot?.action.activeParts.Root?.phase ?? 'loading'} · 当前：
            {snapshot?.body.currentAction ?? '—'} · TTS：{engine?.tts.providerId ?? 'loading'}
          </div>
          <button type="button" disabled={!engine} onClick={() => engine?.actions.stopActions()}>
            <Square size={14} />
            停止并回待机
          </button>
        </div>
        {engine ? (
          <CompanionChatPanel
            engine={engine}
            ttsLanguage={getActiveSpeechSdkTtsLanguage(ttsConfig)}
            ttsEmotionMarkup={resolveTtsEmotionMarkup(ttsConfig)}
          />
        ) : (
          <div className="module-test-panel">角色加载完成后显示聊天面板。</div>
        )}
      </section>
    </main>
  );
}
