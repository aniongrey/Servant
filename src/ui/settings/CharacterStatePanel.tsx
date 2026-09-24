import { useEffect, useMemo, useState } from 'react';
import {
  Download,
  FastForward,
  Heart,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  UserRound
} from 'lucide-react';
import { downloadJsonFile } from '../../app/utils/downloadFile';
import {
  loadCharacterSkill,
  pendingCharacterSkill,
  type CharacterSkill
} from '../../ai/personality/CharacterSkill';
import {
  createBrowserSoulManager,
  type SoulEventType,
  type SoulNeed,
  type SoulState
} from '../../character/state';
import { relationLevel, soulNeedLabels } from '../../soul';
import { PanelTitle, StateRange } from './SettingsControls';

const moodLabels: Record<keyof SoulState['mood'], string> = {
  happiness: '开心',
  anger: '生气',
  sadness: '难过'
};
const quickEvents: Array<{ type: SoulEventType; label: string; description: string }> = [
  { type: 'praise', label: '夸奖', description: '测试：LLM 判断用户正在夸奖 Shiro' },
  { type: 'chat', label: '聊天', description: '测试：LLM 判断用户正在普通聊天' },
  { type: 'belittle', label: '贬低', description: '测试：LLM 判断用户正在贬低 Shiro' }
];

export function CharacterStatePanel() {
  const manager = useMemo(() => createBrowserSoulManager('shiro'), []);
  const [state, setState] = useState(() => manager.getState());
  const [characterSkill, setCharacterSkill] = useState<CharacterSkill>(pendingCharacterSkill);
  useEffect(() => void loadCharacterSkill().then(setCharacterSkill), []);

  const commit = (next: SoulState) => {
    manager.setState(next);
    setState(manager.getState());
  };
  const applyEvent = (item: (typeof quickEvents)[number]) => {
    manager.record(item.type, item.description);
    setState(manager.getState());
  };

  return (
    <div className="aurelia-content-grid aurelia-dashboard-grid">
      <section className="aurelia-panel aurelia-panel-wide aurelia-companion-banner">
        <div className="aurelia-companion-medallion">
          <UserRound size={30} />
        </div>
        <div>
          <span>SOUL STATE · ACTIVE COMPANION</span>
          <h2>{characterSkill.config.displayName}</h2>
          <p>{characterSkill.config.identity} · LLM 只判断事件类型，代码负责状态数值</p>
        </div>
        <div className="aurelia-presence">
          <i /> {soulNeedLabels[state.currentNeed]}
        </div>
      </section>

      <section className="aurelia-panel">
        <PanelTitle title="关系状态" eyebrow="RELATION" />
        <StateRange
          icon={<Heart size={14} />}
          label="亲密度"
          value={state.relation.intimacy}
          onChange={(intimacy) => commit({ ...state, relation: { ...state.relation, intimacy } })}
        />
        <StateRange
          icon={<ShieldCheck size={14} />}
          label="信任度"
          value={state.relation.trust}
          onChange={(trust) => commit({ ...state, relation: { ...state.relation, trust } })}
        />
        <div className="aurelia-status-note">
          关系 · {relationLevel((state.relation.intimacy + state.relation.trust) / 2)}
        </div>
      </section>

      <section className="aurelia-panel">
        <PanelTitle title="当前情绪" eyebrow="MOOD" />
        <div className="aurelia-emotion-controls">
          {(Object.entries(state.mood) as Array<[keyof SoulState['mood'], number]>).map(([key, value]) => (
            <StateRange
              key={key}
              label={moodLabels[key]}
              value={value}
              min={key === 'happiness' ? -100 : 0}
              onChange={(nextValue) => commit({ ...state, mood: { ...state.mood, [key]: nextValue } })}
            />
          ))}
        </div>
      </section>

      <section className="aurelia-panel">
        <PanelTitle title="当前需求" eyebrow="CURRENT NEED" />
        <div className="aurelia-need-grid">
          {(Object.entries(soulNeedLabels) as Array<[SoulNeed, string]>).map(([need, label]) => (
            <button
              className={state.currentNeed === need ? 'active' : ''}
              key={need}
              type="button"
              onClick={() => {
                manager.setNeed(need);
                setState(manager.getState());
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="aurelia-panel">
        <PanelTitle title="事件注入" eyebrow="EVENT → STATE" />
        <div className="aurelia-need-grid">
          {quickEvents.map((item) => (
            <button key={item.type} type="button" onClick={() => applyEvent(item)}>
              <Sparkles size={13} /> {item.label}
            </button>
          ))}
        </div>
        <button
          className="aurelia-inline-action"
          type="button"
          onClick={() => {
            manager.decay(5 * 60_000);
            setState(manager.getState());
          }}
        >
          <FastForward size={14} /> 衰减 5 分钟
        </button>
      </section>

      <section className="aurelia-panel aurelia-panel-wide aurelia-chat-preview">
        <PanelTitle title="最近事件与运行时上下文" eyebrow="PROMPT CONTEXT" />
        <div className="aurelia-soul-runtime-grid">
          <ol className="aurelia-soul-events">
            {state.recentEvents.length ? (
              [...state.recentEvents].reverse().map((event) => (
                <li key={event.id}>
                  <strong>{event.type}</strong>
                  <span>{event.description}</span>
                </li>
              ))
            ) : (
              <li className="empty">还没有事件</li>
            )}
          </ol>
          <pre>{manager.getPromptContext()}</pre>
        </div>
        <p className="aurelia-copy">
          保存键：<code>soul-state:shiro</code> · 最近仅保留 10 条事件 · 更新时间：
          {new Date(state.updatedAt).toLocaleString()}
        </p>
        <div className="aurelia-settings-actions">
          <button
            type="button"
            onClick={() => {
              manager.load();
              setState(manager.getState());
            }}
          >
            <RefreshCw size={14} /> 从 Runtime 刷新
          </button>
          <button
            type="button"
            onClick={() => {
              manager.reset();
              setState(manager.getState());
            }}
          >
            <RotateCcw size={14} /> 恢复初始状态
          </button>
          <button type="button" onClick={() => downloadJsonFile('shiro-soul-state.json', state)}>
            <Download size={14} /> 导出状态
          </button>
          <a className="aurelia-action-link" href="/pages/soul-test.html" target="_blank" rel="noreferrer">
            打开独立验收页
          </a>
        </div>
      </section>
    </div>
  );
}
