import { useEffect, useMemo, useRef, useState } from 'react';
import bundled from '../../character/motion/assets/actions/full-body-motion-config.json';
import { backendFetch } from '../../app/network/backendFetch';
import type { FullBodyConfig } from '../../character/motion/actions/emotionConfig';
import {
  RealtimeGatewayClient,
  type RealtimeConnectionState
} from '../../app/network/realtime/RealtimeGatewayClient';
import {
  ACTION_VOICE_TOPIC,
  parseVoiceStreamEvent,
  type DesktopReplySegment,
  type VoiceStreamEvent
} from '../../app/network/realtime/VoiceStreamProtocol';
import { isAbortError } from '../../app/utils/delay';
import { readStoredJson, writeStoredJson } from '../../app/settings/browserStorage';
import { EMOTION_TEST_SETTINGS_STORAGE_KEY } from '../../app/settings/storageKeys';
import { pushEmotionTest } from './pushEmotionTest';
import './emotion-test.css';

const LONG_TEXT =
  '让我慢慢说明一下。我会先做出这个动作，然后继续把话说完。即使动作片段已经结束，仍然应该保持当前表情，并用默认说话动作填充剩余语音。你可以观察我的眼睛、耳朵和身体，确认微动作是否自然，直到这段语音播放完成后再回到待机。';

export function EmotionTestPage() {
  const client = useMemo(() => new RealtimeGatewayClient(), []);
  const [saved] = useState(loadEmotionTestSettings);
  const [connection, setConnection] = useState<RealtimeConnectionState>('disconnected');
  const [config, setConfig] = useState<FullBodyConfig>(bundled);
  const [emotion, setEmotion] = useState(saved.emotion);
  const [text, setText] = useState(saved.text);
  const [spokenText, setSpokenText] = useState(saved.spokenText);
  const [queue, setQueue] = useState(saved.queue);
  const [stream, setStream] = useState(saved.stream);
  const [interval, setInterval] = useState(saved.interval);
  const [feedback, setFeedback] = useState('等待连接 WebSocket 网关');
  const [logs, setLogs] = useState<string[]>([]);
  const active = useRef<{ id: string; controller: AbortController } | null>(null);
  const receiptTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const definitions = config.emotion as Record<
    string,
    FullBodyConfig['emotion'][keyof FullBodyConfig['emotion']]
  >;
  const definition = definitions[emotion];
  const segment: DesktopReplySegment = {
    text: text.trim(),
    spokenText: spokenText.trim() || text.trim(),
    emotion: 'neutral',
    intensity: 0.5,
    shortAction: emotion,
    expression: definition?.expression
  };

  useEffect(() => {
    writeStoredJson(EMOTION_TEST_SETTINGS_STORAGE_KEY, { emotion, text, spokenText, queue, stream, interval });
  }, [emotion, text, spokenText, queue, stream, interval]);
  const log = (label: string, body: unknown) =>
    setLogs((current) =>
      [`${new Date().toLocaleTimeString()} ${label}\n${JSON.stringify(body, null, 2)}`, ...current].slice(
        0,
        40
      )
    );
  const send = (event: VoiceStreamEvent) => {
    if (!client.sendCommand(ACTION_VOICE_TOPIC, 'publish', event))
      throw new Error('WebSocket 未连接，未发送');
    log('发送', event);
  };

  useEffect(() => {
    const abort = new AbortController();
    void backendFetch('/api/full-body-motion-config', { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('配置读取失败');
        setConfig(await response.json());
      })
      .catch((error) => {
        if (!abort.signal.aborted) log('使用内置配置', String(error));
      });
    const offState = client.onStateChange(setConnection);
    const offMessage = client.onMessage((message) => {
      if (message.type === 'ack' || message.type === 'error') log('网关', message);
      if (message.type === 'error') setFeedback(`网关拒绝：${message.message}`);
    });
    const offVoice = client.on(ACTION_VOICE_TOPIC, (payload) => {
      const event = parseVoiceStreamEvent(payload);
      if (!event || event.id !== active.current?.id) return;
      if (event.type === 'speech-playback-started' || event.type === 'speech-playback-completed') {
        clearTimeout(receiptTimer.current);
        log('Desktop 回执', event);
        setFeedback(
          event.type === 'speech-playback-started'
            ? 'Desktop 已开始处理，正在播放动作与语音'
            : 'Desktop 已完成，回到待机'
        );
        if (event.type === 'speech-playback-completed') active.current = null;
      }
    });
    client.connect();
    return () => {
      abort.abort();
      active.current?.controller.abort();
      if (active.current)
        client.sendCommand(ACTION_VOICE_TOPIC, 'publish', {
          type: 'speech-cancel',
          id: active.current.id,
          source: 'conversation'
        });
      clearTimeout(receiptTimer.current);
      offState();
      offMessage();
      offVoice();
      client.close();
    };
  }, [client]);

  useEffect(() => {
    if (definitions[emotion] || !Object.keys(definitions).length) return;
    setEmotion(Object.keys(definitions)[0]);
  }, [config, emotion]);

  function stop() {
    const current = active.current;
    if (!current) return;
    current.controller.abort();
    clearTimeout(receiptTimer.current);
    try {
      send({ type: 'speech-cancel', id: current.id, source: 'conversation' });
      setFeedback('已发送中断，等待 Desktop 结束回执');
    } catch (error) {
      setFeedback(String(error));
    }
  }
  async function play(segments: DesktopReplySegment[]) {
    if (!client.isOpen()) {
      setFeedback('WebSocket 未连接');
      return;
    }
    const normalizedSegments = segments.map((item) => {
      const actionId = definitions[item.shortAction] ? item.shortAction : emotion;
      const action = definitions[actionId];
      return action ? { ...item, shortAction: actionId, expression: action.expression } : item;
    });
    if (normalizedSegments.some((item) => !definitions[item.shortAction])) {
      setFeedback('队列含有未知 emotion，请重新选择');
      return;
    }
    if (segments === queue) setQueue(normalizedSegments);
    stop();
    const current = { id: `emotion-test-${crypto.randomUUID()}`, controller: new AbortController() };
    active.current = current;
    setFeedback('已开始推送，等待 Desktop 回执');
    receiptTimer.current = setTimeout(() => {
      if (active.current?.id === current.id)
        setFeedback('尚未收到 Desktop 开始回执，请确认 desktop 已打开并连接同一网关');
    }, 8000);
    try {
      await pushEmotionTest(send, current.id, normalizedSegments, stream, interval * 1000, current.controller.signal);
    } catch (error) {
      if (isAbortError(error)) return;
      current.controller.abort();
      client.sendCommand(ACTION_VOICE_TOPIC, 'publish', {
        type: 'speech-cancel',
        id: current.id,
        source: 'conversation'
      });
      if (active.current?.id === current.id) {
        clearTimeout(receiptTimer.current);
        active.current = null;
        setFeedback(String(error));
      }
    }
  }

  return (
    <main className="emotion-test-page">
      <header>
        <div>
          <small>DESKTOP PERFORMANCE LAB</small>
          <h1>Emotion 推送测试</h1>
          <p>模拟 LLM 分段回复 → WebSocket → Desktop 动作、微动作、表情与 TTS</p>
        </div>
        <span data-state={connection}>
          {connection === 'connected'
            ? '● 网关已连接'
            : connection === 'connecting'
            ? '○ 连接中'
            : '○ 未连接'}
        </span>
      </header>
      <nav>
        <a href="/pages.html">全部页面</a>
        <a href="/vrma-editor">编辑动作配置</a>
        <a href="/pages/desktop.html" target="_blank" rel="noreferrer">
          浏览器 Desktop
        </a>
      </nav>
      <p className="emotion-test-note">
        打开桌面 desktop 后再发送。台词在 desktop 播放，请先配置可用的 TTS；本页不调用 LLM。emotion
        使用真实回复里的 shortAction 字段传递。
      </p>
      <div className="emotion-test-grid">
        <section>
          <h2>单个 Emotion</h2>
          <label>
            用途 / Emotion
            <select value={emotion} onChange={(event) => setEmotion(event.target.value)}>
              {Object.entries(definitions).map(([id, value]) => (
                <option key={id} value={id}>
                  {value.purpose} · {id}
                </option>
              ))}
            </select>
          </label>
          {definition && (
            <div className="emotion-test-meta">
              <strong>表情：{definition.expression}</strong>
              <span>微动作：{definition.microdynamics.join('、') || '无'}</span>
              <span>
                VRMA：{definition.vrma.description} · {definition.vrma.start}–{definition.vrma.end} 帧
              </span>
              <small>{definition.vrma.file}</small>
            </div>
          )}
          <label>
            显示台词
            <textarea
              maxLength={1000}
              rows={4}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <label>
            TTS 台词（留空使用显示台词）
            <textarea
              maxLength={2000}
              rows={2}
              value={spokenText}
              onChange={(event) => setSpokenText(event.target.value)}
            />
          </label>
          <div className="emotion-test-buttons">
            <button
              onClick={() => {
                setText(LONG_TEXT);
                setSpokenText('');
              }}
            >
              填入长语音台词
            </button>
            <button
              disabled={!segment.text || queue.length >= 32}
              onClick={() => setQueue([...queue, segment])}
            >
              加入连续测试
            </button>
            <button
              className="primary"
              disabled={connection !== 'connected' || !segment.text}
              onClick={() => void play([segment])}
            >
              推送当前 Emotion
            </button>
          </div>
        </section>
        <section>
          <h2>
            连续测试 <small>{queue.length} 段</small>
          </h2>
          <div className="emotion-test-buttons">
            <button
              onClick={() =>
                setQueue(
                  Object.entries(definitions)
                    .slice(0, 32)
                    .map(([id, value]) => ({
                      shortAction: id,
                      emotion: 'neutral' as const,
                      intensity: 0.5,
                      expression: value.expression,
                      text: `现在测试${value.purpose}。你可以观察我的动作、表情和微动作。`,
                      spokenText: `现在测试${value.purpose}。你可以观察我的动作、表情和微动作。`
                    }))
                )
              }
            >
              填入全部 Emotion
            </button>
            <button onClick={() => setQueue([])}>清空</button>
          </div>
          <div className="emotion-test-queue">
            {!queue.length && <p>将不同 Emotion 加入队列，Desktop 按每段语音结束依次切换。</p>}
            {queue.map((item, index) => (
              <div key={index}>
                <strong>
                  {index + 1}. {definitions[item.shortAction]?.purpose ?? item.shortAction}
                </strong>
                <small>表情：{item.expression ?? '跟随 Emotion'}</small>
                <label>
                  第 {index + 1} 段台词
                  <input
                    maxLength={1000}
                    value={item.text}
                    onChange={(event) =>
                      setQueue(
                        queue.map((row, i) =>
                          i === index
                            ? { ...row, text: event.target.value, spokenText: event.target.value }
                            : row
                        )
                      )
                    }
                  />
                </label>
                <button
                  aria-label={`移除第${index + 1}段`}
                  onClick={() => setQueue(queue.filter((_, i) => i !== index))}
                >
                  移除
                </button>
              </div>
            ))}
          </div>
          <label className="emotion-test-toggle">
            <input type="checkbox" checked={stream} onChange={(event) => setStream(event.target.checked)} />
            模拟流式分段推送
          </label>
          {stream && (
            <label>
              分段推送间隔（秒）
              <input
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={interval}
                onChange={(event) => setInterval(Number(event.target.value))}
              />
            </label>
          )}
          <div className="emotion-test-buttons">
            <button
              className="primary"
              disabled={connection !== 'connected' || !queue.length}
              onClick={() => void play(queue)}
            >
              推送连续测试
            </button>
            <button onClick={stop} disabled={connection !== 'connected'}>
              中断并回待机
            </button>
          </div>
        </section>
      </div>
      <p className="emotion-test-feedback" role="status">
        {feedback}
      </p>
      <details>
        <summary>当前单段 WebSocket 报文</summary>
        <pre>
          {JSON.stringify(
            {
              version: 1,
              type: 'command',
              feature: 'action.voice',
              action: 'publish',
              payload: {
                type: 'reply-sequence',
                id: 'emotion-test-…',
                segments: [segment],
                source: 'conversation'
              }
            },
            null,
            2
          )}
        </pre>
      </details>
      <section>
        <h2>发送与回执日志</h2>
        <button onClick={() => setLogs([])}>清空日志</button>
        <div className="emotion-test-logs">
          {logs.length ? (
            logs.map((entry, index) => <pre key={index}>{entry}</pre>)
          ) : (
            <p>发送后查看网关确认和 Desktop 播放回执。</p>
          )}
        </div>
      </section>
    </main>
  );
}

function loadEmotionTestSettings() {
  const saved = readStoredJson(EMOTION_TEST_SETTINGS_STORAGE_KEY);
  if (!saved || typeof saved !== 'object' || Array.isArray(saved))
    return {
      emotion: 'shrug_small',
      text: '唉，这件事我也没有办法呢。',
      spokenText: '',
      queue: [] as DesktopReplySegment[],
      stream: true,
      interval: 1
    };
  const value = saved as Record<string, unknown>;
  const queue = Array.isArray(value.queue)
    ? value.queue.slice(0, 32).flatMap((segment) => {
        const parsed = parseVoiceStreamEvent({
          type: 'reply-stream-start',
          id: 'restore',
          source: 'conversation',
          segment
        });
        return parsed?.type === 'reply-stream-start' ? [parsed.segment] : [];
      })
    : [];
  return {
    emotion: typeof value.emotion === 'string' ? value.emotion : 'shrug_small',
    text: typeof value.text === 'string' ? value.text.slice(0, 1000) : '唉，这件事我也没有办法呢。',
    spokenText: typeof value.spokenText === 'string' ? value.spokenText.slice(0, 2000) : '',
    queue,
    stream: typeof value.stream === 'boolean' ? value.stream : true,
    interval: typeof value.interval === 'number' && Number.isFinite(value.interval)
      ? Math.max(0, Math.min(10, value.interval))
      : 1
  };
}
