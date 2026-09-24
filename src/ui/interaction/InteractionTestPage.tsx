import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import characterConfig from '../../character/vrm/assets/default-character.json';
import { resolveVrmModelOption, vrmModelOptions } from '../../character/vrm/assets/vrmModels';
import { VrmStage } from '../../character/vrm/VrmStage';
import { normalizeAvatarFitConfig, type AvatarFitConfig } from '../../character/ik/AvatarFitConfig';
import { defaultCharacterRenderConfig } from '../../character/vrm/CharacterRenderConfig';
import type { AgentRuntime } from '../../ai/AgentRuntime';
import type { RuntimeSnapshot } from '../../app/runtimeTypes';
import type { TtsProvider, TtsSpeakOptions } from '../../ai/tts/types';

const avatarFitConfig = normalizeAvatarFitConfig(characterConfig.avatarFit as Partial<AvatarFitConfig>);

export function InteractionTestPage() {
  const [modelId, setModelId] = useState(() => resolveVrmModelOption('').id);
  const [engine, setEngine] = useState<AgentRuntime | null>(null);
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [stageStatus, setStageStatus] = useState('正在初始化 WebGL…');
  const [clock, setClock] = useState(Date.now());
  const [scenario, setScenario] = useState('等待测试');
  const scenarioRun = useRef(0);
  const ttsProvider = useMemo(() => new DemoTtsProvider(), []);
  const model = resolveVrmModelOption(modelId);

  useEffect(() => {
    if (!engine) return;
    setSnapshot(engine.store.getSnapshot());
    return engine.store.subscribe(() => setSnapshot(engine.store.getSnapshot()));
  }, [engine]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(
    () => () => {
      scenarioRun.current += 1;
      ttsProvider.cancel();
    },
    [ttsProvider]
  );

  const handleEngineReady = useCallback((next: AgentRuntime) => {
    setEngine(next);
    setStageStatus('VRM 已载入，点击角色头部即可测试摸头');
  }, []);
  const handleStageStatus = useCallback((message: string) => setStageStatus(message), []);
  const debug = engine?.interaction.getDebugSnapshot(clock);

  const runSpeech = async (text = '我正在说话，同时驱动身体动作和口型。') => {
    if (!engine) return;
    engine.interaction.onLlmResponseStart();
    await engine.speech.sayText(text, { intent: 'interaction_demo' });
  };

  const runConversationFlow = async () => {
    if (!engine) return;
    const runId = ++scenarioRun.current;
    setScenario('Demo C · listening');
    engine.interaction.onListeningStart();
    await wait(900);
    if (runId !== scenarioRun.current) return;
    setScenario('Demo C · thinking');
    engine.interaction.onListeningEnd();
    await wait(1000);
    if (runId !== scenarioRun.current) return;
    setScenario('Demo C · speaking');
    await runSpeech('你好，我已经听到你说的话啦。');
    if (runId !== scenarioRun.current) return;
    setScenario('Demo C · 完成');
  };

  const runMusicInterruptionFlow = async () => {
    if (!engine) return;
    const runId = ++scenarioRun.current;
    setScenario('Demo E · 音乐开始');
    engine.actions.setMusicPlaying(true);
    await wait(900);
    if (runId !== scenarioRun.current) return;
    setScenario('Demo E · 用户开始说话');
    engine.interaction.onListeningStart();
    await wait(850);
    if (runId !== scenarioRun.current) return;
    setScenario('Demo E · thinking');
    engine.interaction.onListeningEnd();
    await wait(850);
    if (runId !== scenarioRun.current) return;
    setScenario('Demo E · speaking');
    await runSpeech('聊天结束后，如果音乐还在，我会继续跳舞。');
    if (runId !== scenarioRun.current) return;
    setScenario('Demo E · 已恢复 dancing');
  };

  const reset = () => {
    scenarioRun.current += 1;
    ttsProvider.cancel();
    engine?.actions.setMusicPlaying(false);
    engine?.interaction.setState('idle');
    setScenario('已重置');
  };

  const touchMany = (count: number) => {
    if (!engine) return;
    for (let index = 0; index < count; index += 1) engine.actions.headClick();
  };

  return (
    <main className="interactionTestShell">
      <header className="interactionHeader">
        <div>
          <span className="interactionEyebrow">CHARACTER LIFE LAB</span>
          <h1>小互动 Demo 测试台</h1>
          <p>真实 VRM · 真实 ActionRuntime · 状态与表现同步观察</p>
        </div>
        <div className="headerTools">
          <a href="/debug">返回主调试台</a>
          <button disabled={!engine} onClick={reset}>
            重置场景
          </button>
        </div>
      </header>

      <section className="interactionWorkspace">
        <div className="interactionStageCard">
          <div className="stageToolbar">
            <label>
              VRM 角色
              <select value={model.id} onChange={(event) => setModelId(event.currentTarget.value)}>
                {vrmModelOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="stageConnection" data-ready={Boolean(engine)}>
              {engine ? '● RUNTIME READY' : '○ LOADING'}
            </span>
          </div>
          <div className="interactionStage">
            <VrmStage
              modelUrl={model.url}
              avatarFitConfig={avatarFitConfig}
              holdMicroMotionEnabled
              footIkEnabled
              ttsProvider={ttsProvider}
              renderConfig={defaultCharacterRenderConfig}
              onEngineReady={handleEngineReady}
              onStatus={handleStageStatus}
            />
            <div className="stageHint">点击角色头部测试 Q 弹与连续摸头</div>
            {debug?.state === 'listening' ? (
              <div className="stateEffect listeningEffect">
                👂
                <i />
                <i />
                <i />
              </div>
            ) : null}
            {debug?.state === 'thinking' ? (
              <div className="stateEffect thinkingEffect">
                思考中<span>···</span>
              </div>
            ) : null}
            {debug?.state === 'speaking' ? (
              <div className="stateEffect speakingEffect">
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
            ) : null}
            {debug?.state === 'dancing' ? <div className="stateEffect dancingEffect">♫ ♪</div> : null}
            {debug?.state === 'error' ? <div className="stateEffect errorEffect">?</div> : null}
            {snapshot?.speech.text ? (
              <div className="demoSpeech" data-speaking={snapshot.speech.speaking}>
                {snapshot.speech.text}
              </div>
            ) : null}
          </div>
          <div className="stageStatus">
            <span>{stageStatus}</span>
            <strong>{scenario}</strong>
          </div>
        </div>

        <aside className="interactionControls">
          <Panel title="状态流程" subtitle="idle → listening → thinking → speaking">
            <div className="buttonGrid">
              <button onClick={() => engine?.interaction.setState('idle')} disabled={!engine}>
                Idle
              </button>
              <button onClick={() => engine?.interaction.onListeningStart()} disabled={!engine}>
                👂 Listening
              </button>
              <button onClick={() => engine?.interaction.onListeningEnd()} disabled={!engine}>
                Thinking
              </button>
              <button onClick={() => void runSpeech()} disabled={!engine}>
                Speaking + 口型
              </button>
              <button
                className="dangerButton"
                onClick={() => engine?.interaction.onError()}
                disabled={!engine}
              >
                Error 1.5s
              </button>
              <button className="accentButton" onClick={() => void runConversationFlow()} disabled={!engine}>
                ▶ 完整 Demo C
              </button>
            </div>
          </Panel>

          <Panel title="互动事件" subtitle="短暂事件与即时 Overlay">
            <div className="buttonGrid">
              <button onClick={() => touchMany(1)} disabled={!engine}>
                摸头 ×1
              </button>
              <button onClick={() => touchMany(5)} disabled={!engine}>
                摸头 ×5
              </button>
              <button onClick={() => engine?.actions.greeting()} disabled={!engine}>
                你好 / Greeting
              </button>
              <button onClick={() => engine?.actions.headClick()} disabled={!engine || !debug?.protected}>
                敲铁盆“咚”
              </button>
            </div>
            <div className="touchMeter">
              <span
                style={{
                  width: `${((debug?.headTouchCount ?? 0) / (debug?.headTouchTriggerCount ?? 5)) * 100}%`
                }}
              />
              <strong>
                {debug?.headTouchCount ?? 0} / {debug?.headTouchTriggerCount ?? 5}
              </strong>
            </div>
          </Panel>

          <Panel title="音乐自动跳舞" subtitle="业务状态优先，结束后恢复 dancing">
            <div className="buttonGrid">
              <button
                className={debug?.musicPlaying ? 'activeButton' : ''}
                onClick={() => engine?.actions.setMusicPlaying(true)}
                disabled={!engine}
              >
                音乐开始
              </button>
              <button onClick={() => engine?.actions.setMusicPlaying(false)} disabled={!engine}>
                音乐停止
              </button>
              <button
                className="accentButton wideButton"
                onClick={() => void runMusicInterruptionFlow()}
                disabled={!engine}
              >
                ▶ 完整 Demo E：跳舞 → 对话 → 恢复
              </button>
            </div>
          </Panel>
        </aside>
      </section>

      <section className="runtimeDashboard">
        <Panel title="当前状态" subtitle="CharacterInteractionController">
          <Status label="State" value={debug?.state ?? 'loading'} highlight />
          <Status label="Music" value={debug?.musicPlaying ? 'playing' : 'stopped'} />
          <Status
            label="Protection"
            value={debug?.protected ? `${Math.ceil(debug.protectedRemainingMs)} ms` : 'off'}
          />
          <Status label="Speech" value={snapshot?.speech.speaking ? 'speaking / lipSync on' : 'silent'} />
        </Panel>
        <Panel title="动作通道" subtitle="ActionRuntime / Body parts">
          <Status label="Actions" value={snapshot?.action.activeActions.join(', ') || '—'} />
          <Status label="Parts" value={formatRecord(snapshot?.action.activeParts)} />
          <Status label="Layers" value={formatRecord(snapshot?.body.activeLayers)} />
          <Status
            label="Expression"
            value={snapshot ? `${snapshot.expression.id} · ${snapshot.expression.weight.toFixed(2)}` : '—'}
          />
        </Panel>
        <Panel title="资源与日志" subtitle="Motion registry / recent events">
          <Status label="Loaded VRMA" value={snapshot?.body.loadedIds.slice(-5).join(', ') || '—'} />
          <ol className="interactionLogs">
            {snapshot?.logs.slice(0, 6).map((log) => (
              <li data-level={log.level} key={`${log.at}-${log.message}`}>
                {log.message}
              </li>
            )) ?? <li>等待 Runtime 日志</li>}
          </ol>
        </Panel>
      </section>
    </main>
  );
}

function Panel({
  title,
  subtitle,
  children
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="testPanel">
      <header>
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </header>
      {children}
    </section>
  );
}
function Status({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="statusRow">
      <span>{label}</span>
      <strong data-highlight={highlight}>{value}</strong>
    </div>
  );
}
function formatRecord(value: Record<string, unknown> | undefined): string {
  if (!value || Object.keys(value).length === 0) return '—';
  return Object.entries(value)
    .map(
      ([key, item]) =>
        `${key}: ${
          typeof item === 'object' && item
            ? `${String((item as { actionId?: string }).actionId ?? '')}/${String(
                (item as { phase?: string }).phase ?? ''
              )}`
            : String(item)
        }`
    )
    .join(' · ');
}
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

class DemoTtsProvider implements TtsProvider {
  readonly id = 'interaction-demo';
  private cancelCurrent?: () => void;
  isSupported(): boolean {
    return true;
  }
  speak(text: string, options: TtsSpeakOptions = {}): Promise<void> {
    this.cancel();
    return new Promise((resolve) => {
      const timer = window.setTimeout(done, Math.min(4200, Math.max(1300, text.length * 105)));
      const onAbort = () => done();
      const self = this;
      function done() {
        window.clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        if (self.cancelCurrent === done) self.cancelCurrent = undefined;
        resolve();
      }
      this.cancelCurrent = done;
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.signal?.aborted) done();
    });
  }
  cancel(): void {
    this.cancelCurrent?.();
    this.cancelCurrent = undefined;
  }
}
