import { useEffect, useMemo, useRef, useState } from 'react';
import {
  RealtimeGatewayClient,
  type RealtimeConnectionState
} from '../../app/network/realtime/RealtimeGatewayClient';
import { parseChatStreamEvent } from '../../app/network/realtime/ChatStreamProtocol';
import { parseVoiceStreamEvent } from '../../app/network/realtime/VoiceStreamProtocol';
import { parseDesktopRealtimeSyncEvent } from '../../app/network/realtime/DesktopRealtimeSync';
import './ws-monitor.css';

interface MonitorEntry {
  id: string;
  at: string;
  topic: string;
  label: string;
  payload: unknown;
}

const MAX_ENTRIES = 300;

interface StreamDefinition {
  topic: string;
  title: string;
  audience: string;
  describe: (payload: unknown) => string;
}

const STREAMS: StreamDefinition[] = [
  {
    topic: 'chat.text',
    title: 'chat.text · 聊天文本同步',
    audience: 'chat 端 + desktop 端',
    describe: (payload) => {
      const event = parseChatStreamEvent(payload);
      if (!event) return 'chat.text';
      if (event.type === 'turn-segment') return `第 ${event.index + 1} 段：${event.message.text}`;
      if (event.type === 'turn-start') return `用户：${event.userMessage.text}`;
      if (event.type === 'turn-phase') return event.searching ? '联网查询中…' : '查询结束';
      if (event.type === 'turn-end') return `回复结束，共 ${event.segmentCount} 段`;
      if (event.type === 'turn-error') return `出错：${event.message}`;
      return '本轮已取消';
    }
  },
  {
    topic: 'action.voice',
    title: 'action.voice · 动作语音同步',
    audience: 'desktop 端',
    describe: (payload) => {
      const event = parseVoiceStreamEvent(payload);
      if (!event) return 'action.voice';
      if (event.type === 'reply-stream-start')
        return `第 1 段（${event.segment.shortAction}）：${event.segment.spokenText}`;
      if (event.type === 'reply-stream-segment')
        return `第 ${event.index + 1} 段（${event.segment.shortAction}）：${event.segment.spokenText}`;
      if (event.type === 'reply-stream-end') return `语音队列完成，共 ${event.segmentCount} 段`;
      if (event.type === 'reply-sequence') return `整包 ${event.segments.length} 段`;
      if (event.type === 'speech-start') return `开始朗读（${event.source ?? 'conversation'}）：${event.text}`;
      if (event.type === 'speech-delta') return `追加：${event.text}`;
      if (event.type === 'speech-end') return `朗读结束${event.source ? `（${event.source}）` : ''}`;
      if (event.type === 'speech-playback-started') return 'Desktop 开始播放';
      if (event.type === 'speech-playback-completed') return 'Desktop 播放完成';
      return '语音已取消';
    }
  },
  {
    topic: 'desktop.sync',
    title: 'desktop.sync · 系统同步',
    audience: 'chat 端 + desktop 端',
    describe: (payload) => {
      const event = parseDesktopRealtimeSyncEvent(payload);
      return event ? event.type : 'desktop.sync';
    }
  }
];

export function WsMonitorPage() {
  const client = useMemo(() => new RealtimeGatewayClient(), []);
  const [connection, setConnection] = useState<RealtimeConnectionState>('disconnected');
  const [entries, setEntries] = useState<MonitorEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [hiddenTopics, setHiddenTopics] = useState<ReadonlySet<string>>(new Set());
  const pausedRef = useRef(paused);

  pausedRef.current = paused;

  useEffect(() => {
    const push = (topic: string, label: string, payload: unknown) => {
      if (pausedRef.current) return;
      setEntries((current) =>
        [
          ...current,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            at: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
            topic,
            label,
            payload
          }
        ].slice(-MAX_ENTRIES)
      );
    };
    const offState = client.onStateChange(setConnection);
    const offs = STREAMS.map((stream) =>
      client.on(stream.topic, (payload) => push(stream.topic, stream.describe(payload), payload))
    );
    client.connect();
    return () => {
      offState();
      for (const off of offs) off();
      client.close();
    };
  }, [client]);

  const toggleTopic = (topic: string) => {
    setHiddenTopics((current) => {
      const next = new Set(current);
      if (next.has(topic)) next.delete(topic);
      else next.add(topic);
      return next;
    });
  };

  const visibleStreams = STREAMS.filter((stream) => !hiddenTopics.has(stream.topic));

  return (
    <main className="wsMonitor">
      <header className="wsMonitorHeader">
        <div>
          <span className="wsMonitorEyebrow">SERVANT REALTIME DUAL STREAM</span>
          <h1>WebSocket 双流监听台</h1>
          <p>
            实时查看服务端发给 chat 端与 desktop 端的两条流：聊天文本同步（chat.text）与动作语音同步
            （action.voice），以及系统级 desktop.sync 事件。
          </p>
        </div>
        <div className="wsMonitorControls">
          <span className="wsMonitorBadge" data-state={connection}>
            <i />
            {connection === 'connected' ? '网关已连接' : connection === 'connecting' ? '连接中' : '已断开'}
          </span>
          <button type="button" className="wsMonitorButton" onClick={() => setPaused((value) => !value)}>
            {paused ? '恢复滚动' : '暂停'}
          </button>
          <button type="button" className="wsMonitorButton" onClick={() => setEntries([])}>
            清空
          </button>
        </div>
      </header>

      <nav className="wsMonitorFilters" aria-label="流过滤">
        {STREAMS.map((stream) => (
          <button
            key={stream.topic}
            type="button"
            data-topic={stream.topic}
            data-hidden={hiddenTopics.has(stream.topic)}
            onClick={() => toggleTopic(stream.topic)}
          >
            {stream.title}
          </button>
        ))}
        <span className="wsMonitorCount">{entries.length} 条</span>
      </nav>

      <div className="wsMonitorGrid" style={{ gridTemplateColumns: `repeat(${visibleStreams.length}, minmax(0, 1fr))` }}>
        {visibleStreams.map((stream) => (
          <MonitorStreamPanel key={stream.topic} stream={stream} entries={entries} />
        ))}
      </div>
    </main>
  );
}

function MonitorStreamPanel({
  stream,
  entries
}: {
  stream: StreamDefinition;
  entries: MonitorEntry[];
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const streamEntries = useMemo(() => entries.filter((entry) => entry.topic === stream.topic), [entries, stream.topic]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !stickToBottom.current) return;
    list.scrollTop = list.scrollHeight;
  }, [streamEntries]);

  const toggleEntry = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allExpanded = streamEntries.length > 0 && streamEntries.every((entry) => expandedIds.has(entry.id));
  const toggleAll = () => {
    setExpandedIds(allExpanded ? new Set() : new Set(streamEntries.map((entry) => entry.id)));
  };

  return (
    <section className="wsMonitorStream" data-topic={stream.topic}>
      <header>
        <div className="wsMonitorStreamTitle">
          <strong>{stream.title}</strong>
          <small>
            {stream.audience} · {streamEntries.length} 条
          </small>
        </div>
        <button
          type="button"
          className="wsMonitorToolButton"
          onClick={toggleAll}
          disabled={streamEntries.length === 0}
        >
          {allExpanded ? '收起全部' : '展开全部'}
        </button>
      </header>
      <div
        className="wsMonitorList"
        ref={(node) => {
          listRef.current = node;
          stickToBottom.current = true;
        }}
        onScroll={() => {
          const list = listRef.current;
          if (!list) return;
          stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 32;
        }}
      >
        {streamEntries.length === 0 ? (
          <p className="wsMonitorEmpty">等待 {stream.topic} 事件…</p>
        ) : (
          streamEntries.map((entry) => (
            <MonitorEntryCard
              key={entry.id}
              entry={entry}
              expanded={expandedIds.has(entry.id)}
              onToggle={() => toggleEntry(entry.id)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function MonitorEntryCard({
  entry,
  expanded,
  onToggle
}: {
  entry: MonitorEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const preRef = useRef<HTMLPreElement | null>(null);
  const payloadText = useMemo(() => JSON.stringify(entry.payload, null, 2), [entry.payload]);

  useEffect(() => {
    const pre = preRef.current;
    if (!pre || expanded) return;
    setTruncated(pre.scrollHeight > pre.clientHeight + 1);
  }, [expanded, payloadText]);

  const copyPayload = async () => {
    try {
      await navigator.clipboard.writeText(payloadText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <article data-expanded={expanded} data-truncated={truncated}>
      <header
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        title={expanded ? '点击收起 JSON' : '点击展开 JSON'}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        <i className="wsMonitorChevron" aria-hidden="true" />
        <time>{entry.at}</time>
        <b>{entry.label}</b>
        <button
          type="button"
          className="wsMonitorCopyButton"
          onClick={(event) => {
            event.stopPropagation();
            void copyPayload();
          }}
        >
          {copied ? '已复制' : '复制'}
        </button>
      </header>
      <pre
        ref={preRef}
        onClick={() => {
          if (expanded) return;
          const selection = window.getSelection();
          if (selection && !selection.isCollapsed) return;
          onToggle();
        }}
      >
        {payloadText}
      </pre>
    </article>
  );
}
