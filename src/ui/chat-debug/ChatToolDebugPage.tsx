import { useEffect, useMemo, useState } from 'react';
import {
  RealtimeGatewayClient,
  type RealtimeConnectionState
} from '../../app/network/realtime/RealtimeGatewayClient';
import { CHAT_DEBUG_TOPIC, parseChatDebugEvent, type ChatDebugEvent } from '../../app/network/realtime/ChatDebugProtocol';
import { parseChatStreamEvent } from '../../app/network/realtime/ChatStreamProtocol';

interface TurnDebug {
  id: string;
  message?: string;
  context?: Extract<ChatDebugEvent, { type: 'context' }>;
  call?: Extract<ChatDebugEvent, { type: 'tool-call' }>;
  result?: Extract<ChatDebugEvent, { type: 'tool-result' }>;
  error?: string;
}

export function ChatToolDebugPage() {
  const client = useMemo(() => new RealtimeGatewayClient(), []);
  const [connection, setConnection] = useState<RealtimeConnectionState>('disconnected');
  const [turns, setTurns] = useState<TurnDebug[]>([]);

  useEffect(() => {
    const update = (turnId: string, change: Partial<TurnDebug>) => {
      setTurns((current) => {
        const existing = current.find((turn) => turn.id === turnId);
        const next = existing
          ? current.map((turn) => (turn.id === turnId ? { ...turn, ...change } : turn))
          : [{ id: turnId, ...change }, ...current];
        return next.slice(0, 30);
      });
    };
    const offState = client.onStateChange(setConnection);
    const offDebug = client.on(CHAT_DEBUG_TOPIC, (payload) => {
      const event = parseChatDebugEvent(payload);
      if (!event) return;
      if (event.type === 'context') update(event.turnId, { context: event });
      if (event.type === 'tool-call') update(event.turnId, { call: event });
      if (event.type === 'tool-result') update(event.turnId, { result: event });
      if (event.type === 'error') update(event.turnId, { error: event.message });
    });
    const offChat = client.on('chat.text', (payload) => {
      const event = parseChatStreamEvent(payload);
      if (!event) return;
      if (event.type === 'turn-start') update(event.turnId, { message: event.userMessage.text });
      if (event.type === 'turn-error') update(event.turnId, { error: event.message });
    });
    client.connect();
    return () => {
      offState();
      offDebug();
      offChat();
      client.close();
    };
  }, [client]);

  return (
    <main className="chatToolDebug">
      <header>
        <div>
          <span>SERVANT CHAT DIAGNOSTICS</span>
          <h1>记忆、查询与定时器监听</h1>
          <p>在正常聊天页面发送消息；此页只显示服务端实际读取、调用和执行的数据。</p>
        </div>
        <div className="chatToolDebugActions">
          <b data-state={connection}>{connection === 'connected' ? '已连接' : '连接中'}</b>
          <button type="button" onClick={() => setTurns([])}>清空</button>
        </div>
      </header>
      {turns.length === 0 ? (
        <p className="chatToolDebugEmpty">等待正常聊天请求…</p>
      ) : (
        <section className="chatToolDebugTurns">
          {turns.map((turn) => <TurnCard key={turn.id} turn={turn} />)}
        </section>
      )}
    </main>
  );
}

function TurnCard({ turn }: { turn: TurnDebug }) {
  const context = turn.context;
  return (
    <article className="chatToolDebugTurn">
      <header>
        <div>
          <small>{turn.id}</small>
          <strong>{turn.message ?? context?.input.text ?? '等待消息'}</strong>
        </div>
        {turn.error ? <em>{turn.error}</em> : null}
      </header>
      <div className="chatToolDebugGrid">
        <Panel title="记忆" value={context ? {
          search: context.memory.query,
          matched: context.memory.entries.length,
          entries: context.memory.entries.map((memory) => ({
            summary: memory.summary,
            time: memory.event_time_start ?? memory.created_at,
            importance: memory.importance,
            score: memory.score
          }))
        } : undefined} empty="等待记忆检索" />
        <Panel title="查询" value={turn.call?.call.name === 'web-search' ? {
          call: turn.call.call.arguments,
          result: turn.result?.tool === 'web-search' ? turn.result.details : '等待执行结果'
        } : undefined} empty="本轮未调用查询工具" />
        <Panel title="定时" value={turn.call?.call.name === 'scheduler' ? {
          call: turn.call.call.arguments,
          result: turn.result?.tool === 'scheduler' ? turn.result.details : '等待桌宠执行结果'
        } : undefined} empty="本轮未调用定时工具" />
      </div>
      {context ? <footer>候选工具：{context.input.toolCandidates.join('、') || '无'} · 可用：{context.tools.map(({ name }) => name).join('、') || '无'}{context.input.requiresSchedulerTool ? ' · 定时器强制执行' : ''}{context.input.requiresWebSearchTool ? ' · 查询强制执行' : ''}</footer> : null}
    </article>
  );
}

function Panel({ title, value, empty }: { title: string; value: unknown; empty: string }) {
  return <section><h2>{title}</h2><pre>{value === undefined ? empty : JSON.stringify(value, null, 2)}</pre></section>;
}
