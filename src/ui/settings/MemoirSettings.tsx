import { useEffect, useState } from 'react';
import { BookHeart, Download, Filter, ShieldCheck, Trash2 } from 'lucide-react';
import { clearMemories, loadMemories, type MemoryEntry } from '../../ai/memory/MemoryClient';
import { ConfirmModal, Metric, PanelTitle } from './SettingsControls';

const labels: Record<MemoryEntry['memory_type'], string> = {
  profile: '用户档案',
  preference: '偏好习惯',
  relationship: '重要关系',
  event: '经历事件',
  plan: '计划约定',
  health: '健康信息',
  other: '其他记忆'
};

export function MemoirSettings() {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [category, setCategory] = useState<'all' | MemoryEntry['memory_type']>('all');
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void loadMemories()
        .then((value) => {
          if (active) setEntries(value);
        })
        .catch((cause) => {
          if (active) setError(cause instanceof Error ? cause.message : '记忆服务不可用');
        });
    };
    refresh();
    window.addEventListener('codex-list:memory-updated', refresh);
    return () => {
      active = false;
      window.removeEventListener('codex-list:memory-updated', refresh);
    };
  }, []);

  const visible = category === 'all' ? entries : entries.filter((entry) => entry.memory_type === category);
  const importantCount = entries.filter((entry) => entry.importance >= 0.8).length;
  const exportMemories = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' })
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `servant-memory-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const confirmClearAll = async () => {
    try {
      await clearMemories();
      setEntries([]);
      setConfirmClear(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '清空失败');
    }
  };

  return (
    <div className="aurelia-content-grid aurelia-memoir-layout">
      <section className="aurelia-panel aurelia-panel-wide aurelia-memoir-hero">
        <div className="aurelia-memoir-emblem">
          <BookHeart size={28} />
        </div>
        <div>
          <span>LOCAL MEMORY · LANCEDB</span>
          <h2>把重要的相遇写下来</h2>
          <p>重要信息会保存为本地语义记忆，并在相关对话中回溯原文。</p>
        </div>
        <div className="aurelia-record-only">
          <i /> 本地记忆
        </div>
      </section>

      <section className="aurelia-panel">
        <PanelTitle title="记忆范围" eyebrow="MEMORY SCOPE" />
        <div className="aurelia-memory-scope">
          {Object.entries(labels).map(([id, label]) => (
            <div key={id}>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="aurelia-panel">
        <PanelTitle title="记录概览" eyebrow="LOCAL ARCHIVE" />
        <div className="aurelia-memoir-metrics">
          <Metric label="全部条目" value={String(entries.length)} />
          <Metric label="重要记忆" value={String(importantCount)} />
          <Metric label="最近记录" value={entries[0] ? formatDate(entries[0].created_at, false) : '暂无'} />
        </div>
        <div className="aurelia-settings-note">
          <ShieldCheck size={14} />
          <span>数据仅保存在本机 LanceDB</span>
          <small>{error || '已接入语义召回与原文回溯'}</small>
        </div>
      </section>

      <section className="aurelia-panel aurelia-panel-wide aurelia-memoir-archive">
        <div className="aurelia-memoir-toolbar">
          <PanelTitle title="回忆时间线" eyebrow="TIMELINE" />
          <div>
            <label>
              <Filter size={13} />
              <select
                aria-label="筛选回忆类型"
                value={category}
                onChange={(event) => setCategory(event.currentTarget.value as typeof category)}
              >
                <option value="all">全部类型</option>
                {Object.entries(labels).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={entries.length === 0} onClick={exportMemories} type="button">
              <Download size={13} /> 导出
            </button>
            <button
              className="danger"
              disabled={entries.length === 0}
              onClick={() => setConfirmClear(true)}
              type="button"
            >
              <Trash2 size={13} /> 清空
            </button>
          </div>
        </div>
        {visible.length === 0 ? (
          <div className="aurelia-memoir-empty">
            <BookHeart size={28} />
            <strong>{error || '还没有写下回忆'}</strong>
          </div>
        ) : (
          <div className="aurelia-memoir-list">
            {visible.map((entry) => (
              <article key={entry.id}>
                <div className="aurelia-memoir-date">
                  <time>{formatDate(entry.created_at, false)}</time>
                  <span>{formatDate(entry.created_at, true)}</span>
                </div>
                <div className="aurelia-memoir-card">
                  <header>
                    <span>{labels[entry.memory_type]}</span>
                    <div aria-label={`重要度 ${Math.round(entry.importance * 5)}/5`}>
                      {Array.from({ length: 5 }, (_, index) => (
                        <i data-active={index < Math.round(entry.importance * 5)} key={index} />
                      ))}
                    </div>
                  </header>
                  <h3>{entry.keywords[0] || labels[entry.memory_type]}</h3>
                  <p>{entry.summary}</p>
                  {entry.source_messages?.length ? (
                    <details>
                      <summary>记录来源</summary>
                      {entry.source_messages.map((message) => (
                        <blockquote key={message.id}>“{message.content}”</blockquote>
                      ))}
                    </details>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {confirmClear ? (
        <ConfirmModal
          title="清空全部回忆？"
          description="这会把当前所有记忆标记为已删除。"
          confirmLabel="清空回忆"
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => void confirmClearAll()}
        />
      ) : null}
    </div>
  );
}

function formatDate(value: string, timeOnly: boolean): string {
  return new Intl.DateTimeFormat(
    'zh-CN',
    timeOnly ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' }
  ).format(new Date(value));
}
