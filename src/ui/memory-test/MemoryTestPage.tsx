import { type FormEvent, useEffect, useState } from 'react';
import type { MemoryType } from '../../ai/llm/types';
import {
  clearMemories,
  deleteMemory,
  loadMemories,
  recordExtractedMemories,
  recordMessages,
  retrieveMemories,
  type MemoryEntry
} from '../../ai/memory/MemoryClient';
import './memory-test.css';

const memoryTypes: MemoryType[] = [
  'profile',
  'preference',
  'relationship',
  'event',
  'plan',
  'health',
  'other'
];

export function MemoryTestPage() {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [results, setResults] = useState<MemoryEntry[]>([]);
  const [query, setQuery] = useState('我上次吃了什么？');
  const [summary, setSummary] = useState('昨天中午和小王吃了烧烤');
  const [memoryType, setMemoryType] = useState<MemoryType>('event');
  const [people, setPeople] = useState('小王');
  const [keywords, setKeywords] = useState('烧烤,午饭');
  const [importance, setImportance] = useState(0.7);
  const [status, setStatus] = useState('正在连接本地记忆服务…');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const value = await loadMemories();
    setEntries(value);
    setStatus(`记忆服务正常 · ${value.length} 条有效记忆`);
  };

  useEffect(() => {
    void refresh().catch((error) => setStatus(message(error)));
    return undefined;
  }, []);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      await recordMessages([{ id, role: 'user', text: summary, createdAt }]);
      const created = await recordExtractedMemories([
        {
          memoryType,
          summary,
          people: split(people),
          keywords: split(keywords),
          eventTimeStart: new Date(createdAt).toISOString(),
          eventTimeEnd: null,
          importance,
          sourceMessageIds: [id]
        }
      ]);
      await refresh();
      setStatus(created.length ? '记忆已新增并生成向量' : '检测到相似记忆，未重复新增');
    } catch (error) {
      setStatus(`新增失败：${message(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const search = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const found = await retrieveMemories(query);
      setResults(found);
      setStatus(`向量 + BM25 完成 · 召回 ${found.length} 条记忆`);
    } catch (error) {
      setStatus(`检索失败：${message(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await deleteMemory(id);
    await refresh();
    setResults((current) => current.filter((entry) => entry.id !== id));
  };

  const clear = async () => {
    if (!window.confirm('确定清空全部记忆吗？原始聊天不会被删除。')) return;
    await clearMemories();
    setEntries([]);
    setResults([]);
    setStatus('全部记忆已清空');
  };

  return (
    <main className="memory-test-page">
      <header>
        <div>
          <span>MEMORY MODULE TEST</span>
          <h1>记忆模块测试</h1>
        </div>
        <strong>{status}</strong>
      </header>

      <form onSubmit={search}>
        <h2>原句向量 + BM25 检索</h2>
        <label>
          用户输入
          <textarea value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button disabled={busy || !query.trim()}>运行检索</button>
        <MemoryList entries={results} empty="暂无召回结果" onDelete={remove} />
      </form>

      <form onSubmit={add}>
        <h2>手动新增记忆</h2>
        <label>
          摘要
          <textarea required value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>
        <div className="memory-test-fields">
          <label>
            类型
            <select value={memoryType} onChange={(e) => setMemoryType(e.target.value as MemoryType)}>
              {memoryTypes.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            人物
            <input value={people} onChange={(e) => setPeople(e.target.value)} />
          </label>
          <label>
            关键词
            <input value={keywords} onChange={(e) => setKeywords(e.target.value)} />
          </label>
          <label>
            重要度
            <input
              type="number"
              min="0"
              max="1"
              step="0.1"
              value={importance}
              onChange={(e) => setImportance(Number(e.target.value))}
            />
          </label>
        </div>
        <button disabled={busy}>新增并生成 Embedding</button>
      </form>

      <section className="memory-test-archive">
        <div className="memory-test-title">
          <h2>当前记忆（{entries.length}）</h2>
          <button className="danger" disabled={!entries.length} onClick={() => void clear()}>
            清空全部
          </button>
        </div>
        <MemoryList entries={entries} empty="还没有记忆" onDelete={remove} />
      </section>
    </main>
  );
}

function MemoryList({
  entries,
  empty,
  onDelete
}: {
  entries: MemoryEntry[];
  empty: string;
  onDelete(id: string): Promise<void>;
}) {
  if (!entries.length) return <p className="memory-test-empty">{empty}</p>;
  return (
    <div className="memory-test-list">
      {entries.map((entry) => (
        <article key={entry.id}>
          <div>
            <small>
              {entry.memory_type} · {Math.round(entry.importance * 100)}%
            </small>
            <strong>{entry.summary}</strong>
            <span>{[...entry.people, ...entry.keywords].join(' · ') || '无标签'}</span>
            {entry.score !== undefined ? <em>相似度 {entry.score.toFixed(3)}</em> : null}
            {entry.source_messages?.map((item) => (
              <blockquote key={item.id}>
                {item.role}: {item.content}
              </blockquote>
            ))}
          </div>
          <button className="danger" onClick={() => void onDelete(entry.id)} type="button">
            删除
          </button>
        </article>
      ))}
    </div>
  );
}

function split(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
