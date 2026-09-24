import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import bundled from '../character/motion/assets/actions/full-body-motion-config.json';
import microConfig from '../character/micro-dynamics/micro-dynamics.json';
import { backendFetch } from '../app/network/backendFetch';
import { parseMicroDynamicsConfig } from '../character/micro-dynamics/config';
import { MicroDynamicsRuntime } from '../character/micro-dynamics/MicroDynamicsRuntime';
import { ActionLoader } from '../character/motion/actions/ActionLoader';
import { ActionRuntime } from '../character/motion/actions/ActionRuntime';
import { BodyMotionController } from '../character/motion/BodyMotionController';
import { MotionAssetRegistry } from '../character/motion/MotionAssetRegistry';
import { VrmaLoader } from '../character/motion/VrmaLoader';
import { ThreeBodyMotionPlaybackAdapter } from '../character/motion/ThreeBodyMotionPlaybackAdapter';
import { ExpressionController } from '../character/expression/ExpressionController';
import { VrmExpressionPlaybackAdapter } from '../character/expression/VrmExpressionPlaybackAdapter';
import { RuntimeStore } from '../app/state/RuntimeStore';
import { findEmotionSegment, validateEmotionConfig, type FullBodyConfig } from '../character/motion/actions/emotionConfig';
import type { VrmaSegment, VrmaSegmentConfig } from '../character/motion/assets/vrmaSegments';

export function EmotionConsole({ vrm, segments, visible = true, onStopSegment }: { vrm: VRM | null; segments: VrmaSegmentConfig; visible?: boolean; onStopSegment(): void }) {
  const [config, setConfig] = useState<FullBodyConfig>(bundled);
  const [id, setId] = useState<keyof FullBodyConfig['emotion']>('listen_focus');
  const [seconds, setSeconds] = useState(8);
  const [status, setStatus] = useState('');
  const [active, setActive] = useState('');
  const playback = useRef<{ stop(): void; dispose(): void } | null>(null);
  const definition: { purpose: string; vrma: { file: string; start: number; end: number; description: string }; expression: string; microdynamics: string[] } = config.emotion[id];
  const choices = Object.entries(segments).flatMap(([file, list]) => list.map((segment) => ({ file, ...segment })));
  const boundSegment = findEmotionSegment(definition.vrma, segments);
  const selected = choices.findIndex((segment) => segment.file === definition.vrma.file && boundSegment && segment.start === boundSegment.start && segment.end === boundSegment.end && segment.description === boundSegment.description);
  useEffect(() => {
    const syncSegment = (event: Event) => {
      const { file, original, replacement } = (event as CustomEvent<{ file: string; original: VrmaSegment; replacement: VrmaSegment }>).detail;
      setConfig((current) => {
        const next = structuredClone(current);
        for (const action of Object.values(next.emotion)) {
          const ref = action.vrma;
          if (ref.file === file && ref.start >= original.start && ref.end <= original.end && ref.description === original.description)
            action.vrma = { file, start: replacement.start, end: replacement.end, description: replacement.description };
        }
        return next;
      });
    };
    window.addEventListener('vrma-segment-updated', syncSegment);
    return () => window.removeEventListener('vrma-segment-updated', syncSegment);
  }, []);
  useEffect(() => { if (!visible) playback.current?.dispose(); }, [visible]);
  useEffect(() => {
    void backendFetch('/api/full-body-motion-config').then(async (response) => {
      if (response.ok) setConfig(await response.json());
    }).catch(() => undefined);
    return () => playback.current?.dispose();
  }, [vrm]);
  function patch(value: Partial<typeof definition>) {
    setConfig({ ...config, emotion: { ...config.emotion, [id]: { ...definition, ...value } } });
  }
  async function save() {
    try {
      validateEmotionConfig(config, segments);
      const response = await backendFetch('/api/full-body-motion-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
      if (!response.ok) throw new Error((await response.json()).error);
      setStatus('已写入 full-body-motion-config.json；desktop 重新加载后生效');
    } catch (error) { setStatus(String(error)); }
  }
  function preview() {
    if (!vrm) return;
    try {
      playback.current?.dispose(); onStopSegment();
      validateEmotionConfig(config, segments);
      const store = new RuntimeStore();
      const loader = new ActionLoader({ config, segments });
      const body = new BodyMotionController(new MotionAssetRegistry(loader.createMotionMetas(), new VrmaLoader(vrm)), store,
        new ThreeBodyMotionPlaybackAdapter(new THREE.AnimationMixer(vrm.scene)));
      const adapter = new VrmExpressionPlaybackAdapter(vrm);
      const expression = new ExpressionController(store, adapter);
      const actions = new ActionRuntime(loader, body, store, expression);
      const unsubscribe = store.subscribe(() => {
        const snapshot = store.getSnapshot();
        setActive(`动作：${snapshot.action.activeActions.join('、')} · 表情：${snapshot.expression.id}`);
      });
      const micro = new MicroDynamicsRuntime(vrm, parseMicroDynamicsConfig({ ...microConfig, scheduler: config.microdynamicsSchedule }), true);
      micro.setAutoEnabled(true); actions.setMicroDynamics(micro); actions.startSpeaking();
      let frame = 0; let previous = performance.now(); let stopped = false;
      const stop = () => {
        clearTimeout(timer); actions.returnToIdle();
      };
      const dispose = () => {
        if (stopped) return; stopped = true;
        clearTimeout(timer); cancelAnimationFrame(frame); unsubscribe(); micro.dispose(); void actions.stopAll(); void expression.set('neutral', 1);
        setActive('已停止 · 表情：neutral');
      };
      const timer = setTimeout(stop, Math.max(0.1, seconds) * 1000);
      playback.current = { stop, dispose };
      const update = () => {
        const now = performance.now(); body.update(Math.min(0.05, (now - previous) / 1000));
        const facial = store.getSnapshot().expression; adapter.setExpression(facial.id, facial.weight);
        micro.update(Math.min(0.05, (now - previous) / 1000)); previous = now;
        if (!stopped) frame = requestAnimationFrame(update);
      };
      update(); void actions.play([id]);
      const missing = micro.diagnostics().boneBindings.filter((binding) => !binding.available).map((binding) => binding.logical);
      setStatus(`组合预览：动作结束后填充说话动作，表情保持至模拟语音结束${missing.length ? `；未绑定骨骼：${missing.join('、')}` : ''}`);
    } catch (error) { setStatus(String(error)); }
  }
  return <section className="emotion-console">
    <div className="emotion-body">
      <nav className="emotion-catalog" aria-label="Emotion 用途列表">
        <div className="emotion-catalog-heading"><span>用途</span><span>{Object.keys(config.emotion).length}</span></div>
        {Object.entries(config.emotion).map(([key, value]) =>
          <button type="button" key={key} aria-pressed={id === key} onClick={() => setId(key as typeof id)}>
            <span>{value.purpose}</span><small>{key}</small>
          </button>
        )}
      </nav>
      <div className="emotion-form">
        <header className="emotion-form-heading">
          <span className="vrma-eyebrow">EMOTION</span>
          <h2>{definition.purpose}</h2>
          <code>{id}</code>
        </header>
        <section className="emotion-form-section">
          <div className="emotion-section-heading"><span className="emotion-step">01</span><h3>动作片段</h3></div>
          <label>用途名称<input value={definition.purpose} onChange={(event) => patch({ purpose: event.target.value })} /></label>
          <label>绑定 VRMA 片段<select value={selected} onChange={(event) => {
            const segment = choices[Number(event.target.value)];
            patch({ vrma: { file: segment.file, start: segment.start, end: segment.end, description: segment.description } });
          }}><option value={-1} disabled>请选择有效片段</option>{choices.map((segment, index) => <option key={index} value={index}>{segment.description} · {segment.start}–{segment.end} 帧 · {segment.file}</option>)}</select></label>
          <div className="emotion-segment-meta"><span>{definition.vrma.start}–{definition.vrma.end} 帧</span><span>{(Math.max(1, definition.vrma.end - definition.vrma.start) / 30).toFixed(2)} 秒</span></div>
          <p className="emotion-file-path" title={definition.vrma.file}>{definition.vrma.file}</p>
        </section>
        <section className="emotion-form-section">
          <div className="emotion-section-heading"><span className="emotion-step">02</span><h3>面部表情</h3><span className="emotion-section-note">保持至语音结束</span></div>
          <div className="emotion-expressions" role="group" aria-label="面部表情">
            {Object.keys(config.expressions).map((name) => <button type="button" key={name} aria-pressed={definition.expression === name} onClick={() => patch({ expression: name })}>
              <span>{({ neutral: '中性', happy: '开心', angry: '生气', sad: '悲伤', surprised: '惊讶', relaxed: '放松', fun: '俏皮' } as Record<string, string>)[name] ?? name}</span><small>{name}</small>
            </button>)}
          </div>
          <button className="emotion-text-button" type="button" disabled={!vrm} onClick={() => { if (vrm) void new ExpressionController(new RuntimeStore(), new VrmExpressionPlaybackAdapter(vrm)).set(definition.expression, 1); }}>仅预览表情 ↗</button>
        </section>
        <section className="emotion-form-section">
          <div className="emotion-section-heading"><span className="emotion-step">03</span><h3>微动作</h3><span className="emotion-section-note">已选 {definition.microdynamics.length} 项</span></div>
          {(['A', 'B', 'C'] as const).map((tier) => <fieldset className="emotion-micro-group" key={tier}>
            <legend>{tier} 层 · {tier === 'A' ? '生理微动作' : tier === 'B' ? '状态反馈' : '情绪反馈'}</legend>
            <div className="emotion-micro-options">{microConfig.actions.filter((action) => action.tier === tier).map((action) =>
              <label key={action.id} title={action.description}><input type="checkbox" checked={definition.microdynamics.includes(action.id)} onChange={(event) => patch({ microdynamics: event.target.checked ? [...definition.microdynamics, action.id] : definition.microdynamics.filter((name) => name !== action.id) })} />{action.label}</label>
            )}</div>
          </fieldset>)}
        </section>
        <details className="emotion-global-settings"><summary>全局设置 · 说话填充与自动微动作</summary>
          <label>默认说话动作<select value={config.speaking} onChange={(event) => setConfig({ ...config, speaking: event.target.value })}>{Object.entries(config.emotion).map(([key, value]) => <option key={key} value={key}>{value.purpose}</option>)}</select></label>
          <label className="emotion-auto-toggle"><input type="checkbox" checked={config.microdynamicsSchedule.enabled} onChange={(event) => setConfig({ ...config, microdynamicsSchedule: { ...config.microdynamicsSchedule, enabled: event.target.checked } })} />启用 Desktop A 层自动微动作</label>
          <div className="emotion-schedule-heading"><span>动作</span><span>最短间隔 ms</span><span>最长间隔 ms</span></div>
          {config.microdynamicsSchedule.rules.map((rule, index) => <div className="emotion-schedule-row" key={rule.action}>
            <span>{microConfig.actions.find((action) => action.id === rule.action)?.label}</span>
            {rule.intervalMs.map((value, boundary) => <input key={boundary} aria-label={rule.action + (boundary === 0 ? ' 最短间隔' : ' 最长间隔')} type="number" min={1} value={value} onChange={(event) => {
              const rules = structuredClone(config.microdynamicsSchedule.rules);
              rules[index].intervalMs[boundary] = Number(event.target.value);
              setConfig({ ...config, microdynamicsSchedule: { ...config.microdynamicsSchedule, rules } });
            }} />)}
          </div>)}
        </details>
      </div>
    </div>
    <footer className="emotion-footer">
      <div className="emotion-preview-actions">
        <label>模拟语音<input type="number" aria-label="模拟语音时长（秒）" min={0.1} value={seconds} onChange={(event) => setSeconds(Number(event.target.value))} /><span>秒</span></label>
        <button type="button" disabled={!vrm} onClick={preview}>▶ 组合预览</button>
        <button type="button" aria-label="停止组合" onClick={() => playback.current?.stop()}>停止</button>
        <button className="primary" type="button" onClick={save}>保存配置</button>
      </div>
      {active && <output className="emotion-playback-status" aria-live="polite">{active}</output>}
      {status && <p className="emotion-feedback" role="status">{status}</p>}
    </footer>
  </section>;
}
