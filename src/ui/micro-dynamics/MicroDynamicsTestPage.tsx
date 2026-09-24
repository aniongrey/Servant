import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Pause, Play, RotateCcw, Save } from 'lucide-react';
import rawConfig from '../../character/micro-dynamics/micro-dynamics.json';
import { parseMicroDynamicsConfig } from '../../character/micro-dynamics/config';
import type { MicroDynamicsRuntime } from '../../character/micro-dynamics/MicroDynamicsRuntime';
import type {
  MicroDynamicsAction,
  MicroDynamicsConfig,
  MicroDynamicsTier
} from '../../character/micro-dynamics/types';
import { MicroDynamicsStage } from './MicroDynamicsStage';
import { toServedAssetUrl, vrmModelOptions } from '../../character/vrm/assets/vrmModels';
import { nativeExpressionIds } from '../../character/expression/ExpressionController';
import { backendFetch } from '../../app/network/backendFetch';

const CONFIG_API = '/api/micro-dynamics-config';

export function MicroDynamicsTestPage() {
  const initialConfig = useMemo(() => parseMicroDynamicsConfig(rawConfig), []);
  const [config, setConfig] = useState(initialConfig);
  const [draft, setDraft] = useState(() => stringify(initialConfig));
  const [runtime, setRuntime] = useState<MicroDynamicsRuntime | null>(null);
  const [expression, setExpression] = useState('neutral');
  const [selectedId, setSelectedId] = useState(initialConfig.actions[0]?.id ?? '');
  const [tier, setTier] = useState<MicroDynamicsTier>('A');
  const [status, setStatus] = useState('正在初始化微动态实验室…');
  const [dirty, setDirty] = useState(false);
  const [snapshot, setSnapshot] = useState({
    stateId: 'neutral',
    actionId: null as string | null,
    autoEnabled: false
  });
  const selected = config.actions.find((action) => action.id === selectedId) ?? config.actions[0];
  const diagnostics = runtime?.diagnostics();
  const selectedModelId = resolveModelId(config.model.url);

  const load = useCallback(async () => {
    try {
      const response = await backendFetch(CONFIG_API, { cache: 'no-store' });
      if (!response.ok) throw new Error(`读取失败 (${response.status})`);
      const next = parseMicroDynamicsConfig(await response.json());
      setConfig(next);
      setDraft(stringify(next));
      setSelectedId((current) =>
        next.actions.some((action) => action.id === current) ? current : next.actions[0].id
      );
      setDirty(false);
      setStatus('已从项目 JSON 重新载入');
    } catch (error) {
      setStatus(`使用构建内配置：${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  useEffect(() => void load(), [load]);
  useEffect(() => {
    const timer = window.setInterval(() => runtime && setSnapshot(runtime.getSnapshot()), 100);
    return () => window.clearInterval(timer);
  }, [runtime]);

  const applyDraft = () => {
    try {
      const next = parseMicroDynamicsConfig(JSON.parse(draft));
      setConfig(next);
      setDirty(true);
      setStatus('JSON 已应用到预览（尚未保存）');
    } catch (error) {
      setStatus(`JSON 无效：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const save = async () => {
    try {
      const next = parseMicroDynamicsConfig(JSON.parse(draft));
      const response = await backendFetch(CONFIG_API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: stringify(next)
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? `保存失败 (${response.status})`);
      setConfig(next);
      setDraft(stringify(next));
      setDirty(false);
      setStatus('已保存到 src/character/micro-dynamics/micro-dynamics.json');
    } catch (error) {
      setStatus(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const updateSelected = (patch: Partial<MicroDynamicsAction>) => {
    const next = {
      ...config,
      actions: config.actions.map((action) => (action.id === selected?.id ? { ...action, ...patch } : action))
    };
    setConfig(next);
    setDraft(stringify(next));
    setDirty(true);
  };

  const selectModel = (modelId: string) => {
    const model = vrmModelOptions.find((item) => item.id === modelId);
    if (!model) return;
    const next = { ...config, model: { ...config.model, url: model.url } };
    setConfig(next);
    setDraft(stringify(next));
    setDirty(true);
    setStatus(`正在切换模型：${model.label}`);
  };

  return (
    <main className="micro-dynamics-page">
      <header className="micro-dynamics-header">
        <div>
          <span className="eyebrow">MICRO DYNAMICS LAB · ISOLATED</span>
          <h1>角色微动态工作台</h1>
          <p>A 生理自动运行 · B 状态持续影响 · C 事件短暂覆盖。此页面不接入桌宠运行时。</p>
        </div>
        <div className="micro-dynamics-status" data-dirty={dirty}>
          <strong>{dirty ? '有未保存改动' : '配置已同步'}</strong>
          <span>{status}</span>
        </div>
      </header>

      <section className="micro-dynamics-layout">
        <div className="micro-dynamics-stage-card">
          <MicroDynamicsStage config={config} expression={expression} onReady={setRuntime} onStatus={setStatus} />
          <div className="micro-camera-hint">滚轮缩放 · 左键拖动上下左右观察</div>
          <div className="micro-dynamics-livebar">
            <span>
              STATE <b>{snapshot.stateId}</b>
            </span>
            <span>
              ACTION <b>{snapshot.actionId ?? '—'}</b>
            </span>
            <span>
              AUTO <b>{snapshot.autoEnabled ? 'ON' : 'OFF'}</b>
            </span>
          </div>
        </div>

        <aside className="micro-dynamics-sidebar">
          <section className="micro-panel">
            <label className="micro-field">原生表情＋微动作<select value={expression} onChange={(event) => setExpression(event.target.value)}>{nativeExpressionIds.map((id) => <option key={id}>{id}</option>)}</select></label>
            <a href="/vrma-editor">VRMA＋表情＋微动作组合配置</a>
          </section>
          <section className="micro-panel">
            <div className="micro-panel-title">
              <div>
                <small>层级控制</small>
                <h2>状态与生理层</h2>
              </div>
            </div>
            <label className="micro-field">
              <span>VRM 模型</span>
              <select value={selectedModelId} onChange={(event) => selectModel(event.target.value)}>
                {vrmModelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="micro-field">
              <span>当前 B 状态</span>
              <select
                value={snapshot.stateId}
                disabled={!runtime}
                onChange={(event) => runtime?.setState(event.target.value)}
              >
                {config.states.map((state) => (
                  <option key={state.id} value={state.id}>
                    {state.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="micro-row">
              <button
                type="button"
                disabled={!runtime}
                onClick={() => runtime?.setAutoEnabled(!snapshot.autoEnabled)}
              >
                {snapshot.autoEnabled ? <Pause size={15} /> : <Play size={15} />}
                {snapshot.autoEnabled ? '暂停 A 层' : '运行 A 层'}
              </button>
              <button type="button" disabled={!runtime} onClick={() => runtime?.reset()}>
                <RotateCcw size={15} />
                复位
              </button>
            </div>
          </section>

          <section className="micro-panel">
            <div className="micro-panel-title">
              <div>
                <small>模型能力</small>
                <h2>绑定诊断</h2>
              </div>
            </div>
            <div className="micro-capabilities">
              {[...(diagnostics?.expressionBindings ?? []), ...(diagnostics?.boneBindings ?? [])].map(
                (item) => (
                  <span key={`${item.logical}-${item.actual}`} data-ok={item.available} title={item.actual}>
                    {item.logical}
                  </span>
                )
              )}
            </div>
            <p className="micro-hint">绿色表示当前 VRM 支持该绑定；眼部形变候选保存在 JSON 的 bindings.morphs 中，按顺序匹配。</p>
          </section>
        </aside>
      </section>

      <section className="micro-workbench">
        <div className="micro-panel micro-library">
          <div className="micro-panel-title">
            <div>
              <small>24 ATOMS</small>
              <h2>原子动作测试</h2>
            </div>
          </div>
          <div className="micro-tabs">
            {(['A', 'B', 'C'] as const).map((item) => (
              <button type="button" key={item} data-active={tier === item} onClick={() => setTier(item)}>
                {item} 档
              </button>
            ))}
          </div>
          <div className="micro-action-list">
            {config.actions
              .filter((action) => action.tier === tier)
              .map((action) => (
                <button
                  type="button"
                  key={action.id}
                  data-active={selected?.id === action.id}
                  onClick={() => setSelectedId(action.id)}
                >
                  <span>{action.label}</span>
                  <small>
                    {action.id} · {action.durationMs}ms
                  </small>
                </button>
              ))}
          </div>
        </div>

        <div className="micro-panel micro-editor">
          <div className="micro-panel-title">
            <div>
              <small>ATOM INSPECTOR</small>
              <h2>{selected?.label ?? '未选择动作'}</h2>
            </div>
            <button
              className="micro-primary"
              type="button"
              disabled={!runtime || !selected}
              onClick={() => selected && runtime?.play(selected.id)}
            >
              <Play size={15} />
              播放
            </button>
          </div>
          {selected ? (
            <>
              <div className="micro-form-grid">
                <label className="micro-field">
                  <span>显示名</span>
                  <input
                    value={selected.label}
                    onChange={(event) => updateSelected({ label: event.target.value })}
                  />
                </label>
                <label className="micro-field">
                  <span>时长 ms</span>
                  <input
                    type="number"
                    min="1"
                    value={selected.durationMs}
                    onChange={(event) => updateSelected({ durationMs: Number(event.target.value) })}
                  />
                </label>
                <label className="micro-field">
                  <span>缓动</span>
                  <select
                    value={selected.easing}
                    onChange={(event) =>
                      updateSelected({ easing: event.target.value as MicroDynamicsAction['easing'] })
                    }
                  >
                    {['linear', 'easeIn', 'easeOut', 'easeInOut'].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label className="micro-field micro-span">
                  <span>说明</span>
                  <input
                    value={selected.description}
                    onChange={(event) => updateSelected({ description: event.target.value })}
                  />
                </label>
              </div>
              <div className="micro-track-list">
                {selected.tracks.map((track, trackIndex) => (
                  <div key={`${track.target}-${trackIndex}`}>
                    <strong>{track.target}</strong>
                    <span>{track.randomSign ? '± 随机方向' : '固定方向'}</span>
                    {track.startFromCurrent ? <span>从当前值回归</span> : null}
                    <code>{track.keyframes.map((frame) => `${frame.at}:${frame.value}`).join('  →  ')}</code>
                  </div>
                ))}
              </div>
              <p className="micro-hint">
                眼球和耳朵骨骼轨道使用角度（°），表情使用 0–1
                权重。轨道、关键帧、绑定、状态与调度参数请在右侧完整 JSON 中编辑；点击“应用
                JSON”即可即时预览。
              </p>
            </>
          ) : null}
        </div>

        <div className="micro-panel micro-json-panel">
          <div className="micro-panel-title">
            <div>
              <small>SOURCE OF TRUTH</small>
              <h2>完整 JSON</h2>
            </div>
          </div>
          <textarea
            spellCheck={false}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setDirty(true);
            }}
          />
          <div className="micro-json-actions">
            <button type="button" onClick={() => void load()}>
              <Download size={15} />
              重新调取
            </button>
            <button type="button" onClick={applyDraft}>
              <Play size={15} />
              应用 JSON
            </button>
            <button className="micro-primary" type="button" onClick={() => void save()}>
              <Save size={15} />
              保存到项目
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

function stringify(value: MicroDynamicsConfig): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function resolveModelId(url: string): string {
  const exact = vrmModelOptions.find((model) => model.url === toServedAssetUrl(url));
  if (exact) return exact.id;
  const fileName = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() ?? '').replace(/\.vrm$/i, '');
  return vrmModelOptions.find((model) => model.label === fileName)?.id ?? vrmModelOptions[0]?.id ?? '';
}
