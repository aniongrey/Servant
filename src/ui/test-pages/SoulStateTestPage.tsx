import { useMemo, useState } from 'react';
import { CheckCircle2, FastForward, RotateCcw, Sparkles } from 'lucide-react';
import { MemorySoulStorage, SoulManager, type SoulEventType } from '../../soul';

const scenarios: Array<{ type: SoulEventType; label: string; description: string }> = [
  { type: 'praise', label: '夸奖', description: '测试：LLM 判断为夸奖' },
  { type: 'chat', label: '普通聊天', description: '测试：LLM 判断为普通聊天' },
  { type: 'belittle', label: '贬低', description: '测试：LLM 判断为贬低' }
];

export function SoulStateTestPage() {
  const manager = useMemo(() => new SoulManager({ storage: new MemorySoulStorage() }), []);
  const [state, setState] = useState(() => manager.getState());
  const refresh = () => setState(manager.getState());
  const apply = (type: SoulEventType, description: string) => {
    manager.record(type, description);
    refresh();
  };
  const checks = [
    {
      label: '夸奖提高 happiness / relation',
      pass: state.mood.happiness > 10 || state.relation.intimacy > 20
    },
    { label: '聊天会小幅积累关系', pass: state.relation.intimacy > 20 || state.relation.trust > 30 },
    { label: '贬低提高 anger / sadness', pass: state.mood.anger > 0 || state.mood.sadness > 0 },
    { label: 'recentEvents 不超过 10 条', pass: state.recentEvents.length <= 10 }
  ];

  return (
    <main className="soul-test-page">
      <header className="module-test-header">
        <div>
          <span className="eyebrow">SOUL STATE ACCEPTANCE</span>
          <h1>灵魂状态层 · 独立验收</h1>
          <p>使用内存存储，不会污染角色面板的真实状态。按场景验证事件、惯性、关系积累与 Prompt。</p>
        </div>
        <button
          type="button"
          onClick={() => {
            manager.reset();
            refresh();
          }}
        >
          <RotateCcw size={15} /> 重置沙盒
        </button>
      </header>
      <section className="soul-test-grid">
        <article className="module-test-panel">
          <h2>1. 注入事件</h2>
          <div className="soul-test-actions">
            {scenarios.map((item) => (
              <button key={item.type} type="button" onClick={() => apply(item.type, item.description)}>
                <Sparkles size={14} /> {item.label}
              </button>
            ))}
          </div>
          <h2>2. 时间衰减</h2>
          <div className="soul-test-actions">
            <button
              type="button"
              onClick={() => {
                manager.decay(5 * 60_000);
                refresh();
              }}
            >
              <FastForward size={14} /> +5 分钟
            </button>
            <button
              type="button"
              onClick={() => {
                manager.decay(30 * 60_000);
                refresh();
              }}
            >
              <FastForward size={14} /> +30 分钟
            </button>
          </div>
          <h2>验收观察</h2>
          <ul className="soul-test-checks">
            {checks.map((check) => (
              <li className={check.pass ? 'pass' : ''} key={check.label}>
                <CheckCircle2 size={15} /> {check.label}
              </li>
            ))}
          </ul>
        </article>
        <article className="module-test-panel soul-state-card">
          <h2>实时状态</h2>
          <div className="soul-metrics">
            {Object.entries(state.mood).map(([key, value]) => (
              <div key={key}>
                <span>{key}</span>
                <strong>{value.toFixed(2)}</strong>
              </div>
            ))}
            {Object.entries(state.relation).map(([key, value]) => (
              <div key={key}>
                <span>{key}</span>
                <strong>{value.toFixed(2)}</strong>
              </div>
            ))}
          </div>
          <p>
            currentNeed <strong>{state.currentNeed}</strong>
          </p>
          <p>
            updatedAt <strong>{new Date(state.updatedAt).toLocaleTimeString()}</strong>
          </p>
          <h3>Recent Events ({state.recentEvents.length}/10)</h3>
          <ol>
            {[...state.recentEvents].reverse().map((event) => (
              <li key={event.id}>
                <code>{event.type}</code> {event.description}
              </li>
            ))}
          </ol>
        </article>
        <article className="module-test-panel soul-prompt-card">
          <h2>发送给 LLM 的上下文</h2>
          <pre>{manager.getPromptContext()}</pre>
        </article>
      </section>
    </main>
  );
}
