import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, RefreshCw, Terminal } from 'lucide-react';
import {
  formatLocalDay,
  type ActivityLogChannel,
  type ActivityLogEvent
} from '../../app/logging/ActivityLog';
import { backendFetch } from '../../app/network/backendFetch';
import { PanelTitle } from './SettingsControls';

const filters: Array<{ value: 'all' | ActivityLogChannel; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'chat', label: '聊天' },
  { value: 'scheduler', label: '定时' },
  { value: 'web-search', label: 'Web 搜索' },
  { value: 'memory', label: '记忆' },
  { value: 'runtime', label: '运行时' }
];

export interface ChatLogGroup {
  messageId: string;
  legacy: boolean;
  events: ActivityLogEvent[];
  userMessage?: Record<string, unknown>;
  reply?: Record<string, unknown>;
  replyContext?: Record<string, unknown>;
  sources?: unknown[];
  rawModelOutput?: string;
}

export function groupChatEvents(events: ActivityLogEvent[]): ChatLogGroup[] {
  const groups = new Map<string, ChatLogGroup>();
  for (const event of events.filter(({ channel }) => channel === 'chat')) {
    const userMessage = asRecord(event.details?.userMessage);
    const messageId = typeof userMessage?.id === 'string' ? userMessage.id : event.turnId ?? event.id;
    const group = groups.get(messageId) ?? { messageId, legacy: !userMessage, events: [] };
    group.events.push(event);
    group.userMessage ??= userMessage;
    group.reply ??= asRecord(event.details?.reply);
    group.replyContext ??= asRecord(event.details?.replyContext);
    if (typeof event.details?.rawModelOutput === 'string') group.rawModelOutput = event.details.rawModelOutput;
    if (!group.sources && Array.isArray(event.details?.sources)) group.sources = event.details.sources;
    groups.set(messageId, group);
  }
  return [...groups.values()].sort((left, right) => right.events[0].at - left.events[0].at);
}

export function LogsPanel() {
  const [events, setEvents] = useState<ActivityLogEvent[]>([]);
  const [filter, setFilter] = useState<'all' | ActivityLogChannel>('all');
  const [query, setQuery] = useState('');
  const [day, setDay] = useState(() => formatLocalDay(Date.now()));
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const response = await backendFetch(`/api/activity-logs?day=${encodeURIComponent(day)}`, {
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const value = (await response.json()) as { events?: ActivityLogEvent[] };
      setEvents(Array.isArray(value.events) ? value.events : []);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '日志读取失败');
    }
  }, [day]);
  useEffect(() => void refresh(), [refresh]);
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return events.filter(
      (event) =>
        (filter === 'all' || event.channel === filter) &&
        (!normalized ||
          `${event.channel} ${event.message} ${event.turnId ?? ''} ${JSON.stringify(event.details ?? {})}`
            .toLocaleLowerCase()
            .includes(normalized))
    );
  }, [events, filter, query]);
  const chatGroups = useMemo(() => groupChatEvents(visible), [visible]);
  const ordinaryEvents = visible.filter(({ channel }) => channel !== 'chat');

  return (
    <div className="aurelia-log-layout">
      <section className="aurelia-panel aurelia-log-toolbar">
        <label className="aurelia-search-fake">
          <Search size={14} />
          <input
            aria-label="搜索日志"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索日志"
            value={query}
          />
        </label>
        <div className="aurelia-tag-list">
          {filters.map(({ value, label }) => (
            <button
              aria-pressed={filter === value}
              key={value}
              onClick={() => setFilter(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <input
          aria-label="日志日期"
          onChange={(event) => setDay(event.target.value)}
          type="date"
          value={day}
        />
        <button onClick={() => void refresh()} type="button">
          <RefreshCw size={14} /> 刷新
        </button>
      </section>
      <section className="aurelia-panel aurelia-terminal">
        <PanelTitle title="运行日志" eyebrow="SYSTEM STREAM" />
        {chatGroups.map((group) => (
          <ChatLogCard group={group} key={group.messageId} />
        ))}
        {ordinaryEvents.map((event) => (
          <details className="aurelia-log-event" key={event.id}>
            <summary className="aurelia-log-line" data-tone={event.channel}>
              <time dateTime={new Date(event.at).toISOString()}>
                {new Date(event.at).toLocaleTimeString()}
              </time>
              <b>{event.channel.toUpperCase()}</b>
              <span title={event.turnId}>{event.message}</span>
              <i>{event.status === 'success' ? 'OK' : event.status.toUpperCase()}</i>
            </summary>
            <pre>{JSON.stringify({ turnId: event.turnId, ...event.details }, null, 2)}</pre>
          </details>
        ))}
        {!visible.length ? <p className="aurelia-log-empty">{error || '暂无匹配日志'}</p> : null}
        <div className="aurelia-terminal-foot">
          <Terminal size={13} />
          <span>
            {day} · {events.length} 条事件 · {error || 'ready'}
          </span>
          <i />
        </div>
      </section>
    </div>
  );
}

function ChatLogCard({ group }: { group: ChatLogGroup }) {
  const latest = group.events[0];
  const reply = group.reply;
  const replies = Array.isArray(reply?.replies) ? reply.replies.map(asRecord).filter(Boolean) : [];
  const firstSpeech = group.events.find((event) => typeof event.details?.speech === 'string')?.details;
  const firstParameters = group.events.find(
    (event) => typeof event.details?.emotion === 'string' && typeof event.details?.shortAction === 'string'
  )?.details;
  const visibleReplies = replies.length
    ? replies
    : reply?.speech
    ? [{ speech: reply.speech }]
    : firstSpeech
    ? [{ speech: firstSpeech.speech, ...firstParameters }]
    : [];
  const presentation = replies.length ? undefined : reply ?? firstParameters;
  const status =
    group.events.find(({ status }) => status === 'success' || status === 'error')?.status ?? latest.status;
  const failure = group.events.find(({ status }) => status === 'error');
  return (
    <article className="aurelia-chat-log">
      <header>
        <time>{new Date(latest.at).toLocaleTimeString()}</time>
        <i data-status={status}>{status === 'success' ? '完成' : status === 'error' ? '失败' : '进行中'}</i>
      </header>
      <dl>
        <div>
          <dt>{group.legacy ? '轮次 ID' : '消息 ID'}</dt>
          <dd>
            <code>{group.messageId}</code>
          </dd>
        </div>
        {group.userMessage ? (
          <div>
            <dt>用户消息</dt>
            <dd>{String(group.userMessage.text ?? '')}</dd>
          </div>
        ) : null}
        {presentation ? (
          <div>
            <dt>表情</dt>
            <dd>
              <code>
                {String(presentation.emotion ?? '—')} × {String(presentation.intensity ?? '—')}
              </code>
            </dd>
          </div>
        ) : null}
        {visibleReplies.length ? (
          <div>
            <dt>回复</dt>
            <dd>
              <ol className="aurelia-chat-log-segments">
                {visibleReplies.map((segment, index) => (
                  <li key={index}>
                    {typeof segment?.shortAction === 'string' && segment.shortAction ? (
                      <code>&lt;{segment.shortAction}&gt;</code>
                    ) : null}
                    <span>{String(segment?.speech ?? '')}</span>
                    {segment?.emotion ? (
                      <code>
                        {String(segment.emotion)} × {String(segment.intensity ?? '—')}
                      </code>
                    ) : null}
                  </li>
                ))}
              </ol>
            </dd>
          </div>
        ) : null}
      </dl>
      {group.rawModelOutput ? (
        <details className="aurelia-chat-log-data">
          <summary>查看原生 LLM 回复</summary>
          <pre>{group.rawModelOutput}</pre>
        </details>
      ) : null}
      {group.legacy ? (
        <p className="aurelia-chat-log-legacy">旧版日志仅保存状态摘要，新的聊天会记录完整消息。</p>
      ) : null}
      {failure ? (
        <p className="aurelia-chat-log-error">{String(failure.details?.error ?? failure.message)}</p>
      ) : null}
      {group.replyContext ? (
        <details className="aurelia-chat-log-data">
          <summary>回复上下文：{jsonByteLength(group.replyContext)} 字节</summary>
          <pre>{JSON.stringify(group.replyContext, null, 2)}</pre>
        </details>
      ) : null}
      {group.sources?.length ? (
        <details className="aurelia-chat-log-data">
          <summary>搜索来源 · {group.sources.length}</summary>
          <pre>{JSON.stringify(group.sources, null, 2)}</pre>
        </details>
      ) : null}
    </article>
  );
}

export function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
