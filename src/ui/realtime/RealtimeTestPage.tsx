import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  RealtimeGatewayClient,
  type RealtimeConnectionState
} from '../../app/network/realtime/RealtimeGatewayClient';
import { parseDesktopRealtimeSyncEvent } from '../../app/network/realtime/DesktopRealtimeSync';
import { publishVoiceBroadcast } from '../../ai/tts/voiceBroadcast';
import { requestRealtimeSchedulerTool } from '../../app/network/realtime/RealtimeSchedulerTool';
import { requestRealtimeWebSearch } from '../../app/network/realtime/RealtimeWebSearch';
import type { SchedulerTask, ToolResultEvent } from '../../scheduler/SchedulerTypes';
import { formatSchedule } from '../../scheduler/SchedulerTime';
import './realtime-test.css';

interface LogEntry {
  id: string;
  at: string;
  label: string;
  body: unknown;
}

const BLOCKING_SPEECH_ID = 'realtime-test-blocking-speech';
const BUSINESS_TRIGGER_EXAMPLES = [
  ['新增一次性提醒', '10分钟后提醒我喝水'],
  ['新增每天提醒', '每天晚上9点提醒我休息'],
  ['新增每周提醒', '每周一三五晚上8点提醒我运动'],
  ['列出提醒', '我现在有哪些提醒？'],
  ['修改提醒', '把喝水提醒改成晚上8点半'],
  ['删除提醒', '取消喝水提醒'],
  ['联网查询', '查询香港今天的天气']
] as const;

export function RealtimeTestPage() {
  const client = useMemo(() => new RealtimeGatewayClient(), []);
  const [connection, setConnection] = useState<RealtimeConnectionState>('disconnected');
  const [delaySeconds, setDelaySeconds] = useState('5');
  const [message, setMessage] = useState('起来活动一下');
  const [searchQuery, setSearchQuery] = useState('查询香港今天的天气');
  const [tasks, setTasks] = useState<SchedulerTask[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [speechBlocked, setSpeechBlocked] = useState(false);
  const [lastResult, setLastResult] = useState<ToolResultEvent | null>(null);
  const mounted = useRef(true);

  const log = (label: string, body: unknown) => {
    if (!mounted.current) return;
    setLogs((current) =>
      [
        {
          id: `${Date.now()}-${Math.random()}`,
          at: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          label,
          body
        },
        ...current
      ].slice(0, 80)
    );
  };

  useEffect(() => {
    mounted.current = true;
    const offState = client.onStateChange(setConnection);
    const offMessages = client.onMessage((event) => log('WebSocket', event));
    const offSync = client.on('desktop.sync', (payload) => {
      const event = parseDesktopRealtimeSyncEvent(payload);
      if (!event) return;
      if (event.type === 'tool-result') setLastResult(event);
      if (event.type === 'reminder') log('提醒到点', event);
      if (event.type === 'reminder-started') log('桌宠开始处理', event);
      if (event.type === 'reminder-completed') log('桌宠处理完成', event);
    });
    client.connect();
    return () => {
      mounted.current = false;
      offState();
      offMessages();
      offSync();
      client.close();
    };
  }, [client]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    try {
      await operation();
    } catch (cause) {
      log('失败', cause instanceof Error ? cause.message : cause);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const listTasks = () =>
    run(async () => {
      const result = await requestRealtimeSchedulerTool(client, { action: 'list' });
      const listed = Array.isArray(result.content) ? result.content.filter(isSchedulerTask) : [];
      setTasks(listed);
      log('列出任务', result);
    });

  const addTask = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const delay = Math.max(0.2, Number(delaySeconds) || 5) * 1000;
      const result = await requestRealtimeSchedulerTool(client, {
        action: 'add',
        name: message,
        schedule: { type: 'once', at: Date.now() + delay },
        text: message
      });
      log('新增任务', result);
      await listTasks();
    });
  };

  const removeTask = (taskId: string) =>
    run(async () => {
      const result = await requestRealtimeSchedulerTool(client, { action: 'remove', taskId });
      log('删除任务', result);
      setTasks((current) => current.filter((task) => task.id !== taskId));
    });

  const runSearch = () =>
    run(async () => {
      const result = await requestRealtimeWebSearch(
        client,
        searchQuery.replace(/^(?:查询(?:一下)?|查一下)\s*/, '')
      );
      log('联网搜索', result);
    });

  const startBlockingSpeech = () => {
    publishVoiceBroadcast(
      {
        type: 'speech-start',
        id: BLOCKING_SPEECH_ID,
        text: '这是用于验收防打断的占用语音。',
        source: 'conversation'
      },
      client
    );
    setSpeechBlocked(true);
    log('防打断', '已占用对话语音；此时到点提醒应进入队列，不应打断。');
  };

  const releaseBlockingSpeech = () => {
    publishVoiceBroadcast(
      { type: 'speech-end', id: BLOCKING_SPEECH_ID, text: '防打断测试结束。', source: 'conversation' },
      client
    );
    setSpeechBlocked(false);
    log('防打断', '已释放对话语音；排队的提醒应依次播放。');
  };

  const runNoInterruptScenario = () =>
    run(async () => {
      startBlockingSpeech();
      const result = await requestRealtimeSchedulerTool(client, {
        action: 'add',
        name: '防打断验收提醒',
        schedule: { type: 'once', at: Date.now() + 1_000 },
        text: '防打断验收通过，请确认我是在释放语音后才说的。'
      });
      log('防打断任务已创建', result);
    });

  return (
    <main className="realtimeTestShell">
      <header className="hero">
        <div>
          <span className="eyebrow">SHIRO TOOL PIPELINE</span>
          <h1>工具与定时验收台</h1>
        </div>
        <div className="connectionBadge" data-state={connection}>
          <i />
          {connectionLabel(connection)}
        </div>
      </header>

      <section className="controlCard">
        <div className="sectionHeading">
          <div>
            <span>01 · SCHEDULER</span>
            <h2>定时任务增删与列出</h2>
          </div>
          <button className="ghostButton" onClick={() => void listTasks()} type="button">
            刷新列表
          </button>
        </div>
        <form onSubmit={addTask}>
          <label>
            <span>几秒后</span>
            <input
              min="0.2"
              step="0.1"
              type="number"
              value={delaySeconds}
              onChange={(event) => setDelaySeconds(event.target.value)}
            />
          </label>
          <label className="messageField">
            <span>提醒内容</span>
            <input maxLength={500} value={message} onChange={(event) => setMessage(event.target.value)} />
          </label>
          <button className="primaryButton" disabled={busy || connection !== 'connected'} type="submit">
            新增一次性任务
          </button>
        </form>
        <div className="reminderQueue">
          {tasks.length === 0 ? (
            <p className="emptyLog">点击“刷新列表”读取 scheduler.json</p>
          ) : (
            tasks.map((task) => (
              <article key={task.id}>
                <span>⏱</span>
                <div>
                  <strong>{task.name}</strong>
                  <small>
                    {formatSchedule(task.schedule)} · {task.event.text}
                  </small>
                  <code>ID：{task.id}</code>
                </div>
                <b>{task.enabled ? '启用' : '停用'}</b>
                <button className="dangerButton" onClick={() => void removeTask(task.id)} type="button">
                  删除
                </button>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="controlCard triggerGuide">
        <div className="sectionHeading">
          <div>
            <span>02 · BUSINESS CHAT</span>
            <h2>在正式聊天里这样触发</h2>
          </div>
        </div>
        <p>
          打开桌宠聊天窗口，直接发送下面任一句。命中“叫我 / 提醒我”或提醒管理语句后，会交给 LLM
          只生成工具参数，再通过 5174 同步到 chat 与 desktop；定时工具使用固定反馈，联网成功结果则由角色 LLM
          总结。
        </p>
        <div className="triggerExamples">
          {BUSINESS_TRIGGER_EXAMPLES.map(([label, example]) => (
            <article key={label}>
              <span>{label}</span>
              <code>{example}</code>
            </article>
          ))}
        </div>
        <p className="guideNote">
          联网查询还需先在聊天窗口开启“联网搜索”。“不要提醒我……”以及讨论“提醒我这个触发器”的句子会被排除，不会误建任务。
        </p>
      </section>

      <section className="controlCard">
        <div className="sectionHeading">
          <div>
            <span>03 · NO INTERRUPTION</span>
            <h2>提醒不得打断当前语音</h2>
          </div>
        </div>
        <p>
          点击“一键场景”后等待至少 1 秒；日志应只显示到点排队。点击“释放语音”后，desktop
          才应播放固定成功话术和提醒内容。
        </p>
        <div className="buttonRow">
          <button
            className="primaryButton"
            disabled={busy || speechBlocked}
            onClick={() => void runNoInterruptScenario()}
            type="button"
          >
            一键开始防打断场景
          </button>
          <button
            className="dangerButton"
            disabled={!speechBlocked}
            onClick={releaseBlockingSpeech}
            type="button"
          >
            释放语音
          </button>
        </div>
      </section>

      <section className="controlCard">
        <div className="sectionHeading">
          <div>
            <span>04 · WEB SEARCH + TTS</span>
            <h2>联网资料推送</h2>
          </div>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch();
          }}
        >
          <label className="messageField">
            <span>查询内容</span>
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
          </label>
          <button className="primaryButton" disabled={busy || connection !== 'connected'} type="submit">
            执行联网查询
          </button>
        </form>
        <p>成功时只推送原始资料且不朗读；聊天页面会结合角色卡与 SoulState 生成总结后，再由 desktop 朗读。</p>
      </section>

      <section
        className="resultCard"
        data-status={lastResult?.success === false ? 'canceled' : lastResult ? 'delivered' : 'idle'}
      >
        <span className="resultKicker">LAST TOOL RESULT</span>
        <strong>{lastResult ? lastResult.speech || '资料已返回，等待角色总结' : '等待工具结果'}</strong>
        <pre>
          {lastResult
            ? JSON.stringify(lastResult.content ?? lastResult.error, null, 2)
            : 'chat 与 desktop 将收到相同 tool-result'}
        </pre>
      </section>

      <section className="logCard">
        <div className="sectionHeading">
          <div>
            <span>05 · PROTOCOL</span>
            <h2>验收日志</h2>
          </div>
          <button className="ghostButton" onClick={() => setLogs([])} type="button">
            清空
          </button>
        </div>
        <div className="logList">
          {logs.length === 0 ? (
            <p className="emptyLog">尚无消息</p>
          ) : (
            logs.map((entry) => (
              <article key={entry.id}>
                <time>{entry.at}</time>
                <b>{entry.label}</b>
                <pre>{JSON.stringify(entry.body, null, 2)}</pre>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

function isSchedulerTask(value: unknown): value is SchedulerTask {
  return Boolean(value) && typeof value === 'object' && typeof (value as SchedulerTask).id === 'string';
}

function connectionLabel(state: RealtimeConnectionState): string {
  if (state === 'connected') return '实时网关已连接';
  if (state === 'connecting') return '连接中';
  return '已断开';
}
