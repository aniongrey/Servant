import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChatTurnOrchestrator,
  type ChatTurnOrchestratorOptions,
  type ChatTurnLlm
} from './ChatTurnOrchestrator';
import type { ChatStreamEvent } from '../realtime/ChatStreamProtocol';
import type { VoiceStreamEvent } from '../realtime/VoiceStreamProtocol';
import type { AssistantIntent, AssistantStreamEvent } from '../../../ai/llm/types';

vi.mock('./memoryService', () => ({
  loadRecentChatHistory: vi.fn(async () => []),
  storeUserMessage: vi.fn(async () => undefined),
  persistAssistantReply: vi.fn(async () => undefined),
  loadMemoryContext: vi.fn(async () => ''),
  loadMemoryContextDetails: vi.fn(async () => ({ prompt: '', entries: [] })),
  memoryGet: vi.fn(),
  memoryPost: vi.fn(),
  parseHistory: vi.fn(() => []),
  toStoredMessage: vi.fn((message: { id: string }) => ({ id: message.id })),
  createLlmClientFactory: vi.fn()
}));

import { loadMemoryContextDetails, persistAssistantReply, storeUserMessage } from './memoryService';

interface BroadcastRecord {
  topic: string;
  payload: Record<string, unknown>;
}

const baseRequest = {
  message: { id: 'user-msg-1', role: 'user' as const, text: '今天天气怎么样？', createdAt: 1 },
  llmConfig: { provider: 'openai' } as never,
  personality: {} as never,
  personalityState: {} as never,
  soulContext: '',
  webSearchEnabled: false,
  ttsLanguage: 'zh' as const
};

function createIntent(overrides: Partial<AssistantIntent> = {}): AssistantIntent {
  return {
    replies: [
      { speech: '第一段回复。', emotion: 'happy', intensity: 0.4, shortAction: 'agree_soft' },
      { speech: '第二段回复。', emotion: 'curious', intensity: 0.6, shortAction: 'head_tilt' }
    ],
    speech: '第一段回复。\n第二段回复。',
    soulEvent: 'chat',
    emotion: 'happy',
    intensity: 0.4,
    memories: [],
    ...overrides
  };
}

function createLlm(intent: AssistantIntent): ChatTurnLlm {
  return {
    chatWithTools: vi.fn(async () => ({ kind: 'reply' as const, intent })),
    chat: vi.fn(async () => intent),
    translateSpeechSegments: vi.fn(async (texts: string[]) => texts)
  };
}

function createOrchestrator(llm: ChatTurnLlm, overrides: Partial<ChatTurnOrchestratorOptions> = {}) {
  const broadcasts: BroadcastRecord[] = [];
  const orchestrator = new ChatTurnOrchestrator({
    networkFetch: globalThis.fetch,
    broadcast: (topic, payload) => broadcasts.push({ topic, payload: payload as Record<string, unknown> }),
    createLlm: () => llm,
    now: () => 42,
    newId: (() => {
      let counter = 0;
      return () => `id-${++counter}`;
    })(),
    ...overrides
  });
  const chatEvents = () =>
    broadcasts
      .filter((entry) => entry.topic === 'chat.text')
      .map((entry) => entry.payload as unknown as ChatStreamEvent);
  const voiceEvents = () =>
    broadcasts
      .filter((entry) => entry.topic === 'action.voice')
      .map((entry) => entry.payload as unknown as VoiceStreamEvent);
  return { orchestrator, broadcasts, chatEvents, voiceEvents };
}

async function settle(): Promise<void> {
  // A macrotask flushes every pending microtask in the turn pipeline.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.mocked(storeUserMessage).mockClear();
  vi.mocked(persistAssistantReply).mockClear();
  vi.mocked(loadMemoryContextDetails).mockClear();
});

describe('ChatTurnOrchestrator', () => {
  it('broadcasts a multi-segment reply on both streams and ends the turn', async () => {
    const llm = createLlm(createIntent());
    const recordEvent = vi.fn();
    const { orchestrator, chatEvents, voiceEvents } = createOrchestrator(llm, { recordEvent });

    orchestrator.start(baseRequest);
    await settle();

    const chat = chatEvents();
    expect(chat.map((event) => event.type)).toEqual([
      'turn-start',
      'turn-phase',
      'turn-segment',
      'turn-segment',
      'turn-end'
    ]);
    expect(chat[0]).toMatchObject({ userMessage: { id: 'user-msg-1' } });
    expect(chat[2]).toMatchObject({
      index: 0,
      message: { text: '第一段回复。' },
      emotion: 'happy',
      intensity: 0.4,
      shortAction: 'agree_soft'
    });
    expect(chat[3]).toMatchObject({
      index: 1,
      message: { text: '第二段回复。' },
      emotion: 'curious',
      intensity: 0.6,
      shortAction: 'head_tilt'
    });
    expect(chat[4]).toMatchObject({
      segmentCount: 2,
      meta: { soulEvent: 'chat', searching: false }
    });

    const voice = voiceEvents();
    expect(voice.map((event) => event.type)).toEqual([
      'reply-stream-start',
      'reply-stream-segment',
      'reply-stream-end'
    ]);
    expect(voice[0]).toMatchObject({ id: 'turn-id-1', segment: { spokenText: '第一段回复。' } });
    expect(voice[1]).toMatchObject({ segment: { emotion: 'curious', intensity: 0.6 } });
    expect(voice[2]).toMatchObject({ id: 'turn-id-1', segmentCount: 2 });
    expect(storeUserMessage).toHaveBeenCalledOnce();
    expect(persistAssistantReply).toHaveBeenCalledOnce();
    expect(loadMemoryContextDetails).toHaveBeenCalledWith('今天天气怎么样？', expect.any(AbortSignal));
    expect(llm.chatWithTools).toHaveBeenCalledOnce();
    expect(llm.chat).not.toHaveBeenCalled();
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'chat',
        status: 'success',
        turnId: 'turn-id-1',
        details: expect.objectContaining({
          id: 'turn-id-1',
          userMessage: baseRequest.message,
          reply: expect.objectContaining({
            speech: '第一段回复。\n第二段回复。',
            emotion: 'happy',
            replies: [
              { speech: '第一段回复。', emotion: 'happy', intensity: 0.4, shortAction: 'agree_soft' },
              { speech: '第二段回复。', emotion: 'curious', intensity: 0.6, shortAction: 'head_tilt' }
            ]
          }),
          replyContext: expect.objectContaining({
            history: [baseRequest.message],
            input: expect.objectContaining({ text: '今天天气怎么样？' })
          })
        })
      })
    );
  });

  it('lets the main LLM request search, then continues with the tool result', async () => {
    const intent = createIntent({
      replies: [{ speech: '香港今天 28℃。', emotion: 'happy', intensity: 0.4, shortAction: 'agree' }],
      speech: '香港今天 28℃。',
      sourceUrls: ['https://example.com/weather']
    });
    const llm = createLlm(intent);
    llm.chatWithTools = vi.fn(async () => ({
      kind: 'tool-call' as const,
      call: {
        name: 'web-search' as const,
        arguments: { query: '香港今天天气', resolvedQuestion: '香港今天的天气如何？' }
      }
    }));
    const networkFetch = vi.fn(
      async () =>
        new Response(
          '<a class="result__a" href="https://example.com/weather">香港天气</a><a class="result__snippet">香港今天 28℃，晴。</a>',
          { status: 200 }
        )
    ) as unknown as typeof fetch;
    const { orchestrator, chatEvents } = createOrchestrator(llm, { networkFetch });

    orchestrator.start({ ...baseRequest, webSearchEnabled: true });
    await settle();

    expect(llm.chatWithTools).toHaveBeenCalledOnce();
    expect(llm.chat).toHaveBeenCalledOnce();
    expect(chatEvents()).toContainEqual(expect.objectContaining({ type: 'turn-phase', searching: true }));
    expect(chatEvents().find((event) => event.type === 'turn-segment')).toMatchObject({
      message: { kind: 'web-search', sources: [{ url: 'https://example.com/weather' }] }
    });
  });

  it('keeps square-bracket stage text visible while TTS markup is enabled', async () => {
    const intent = createIntent({
      replies: [{ speech: '[困惑]', emotion: 'curious', intensity: 0.5, shortAction: 'curious', ttsEmotion: '疑惑地说' }],
      speech: '[困惑]'
    });
    const llm = createLlm(intent);
    llm.translateSpeechSegments = vi.fn(async () => ['[疑惑地说]嗯？']);
    const { orchestrator, chatEvents, voiceEvents } = createOrchestrator(llm);

    orchestrator.start({ ...baseRequest, ttsEmotionMarkup: 'doubao-2' });
    await settle();

    expect(chatEvents().find((event) => event.type === 'turn-segment')).toMatchObject({
      message: { text: '[困惑]' }
    });
    expect(voiceEvents()[0]).toMatchObject({ segment: { text: '[困惑]', spokenText: '[疑惑地说] [困惑]' } });
  });

  it('publishes the first completed sentence before the LLM finishes', async () => {
    const llm = createLlm(createIntent());
    let emit: ((event: AssistantStreamEvent) => void) | undefined;
    let finish: ((intent: AssistantIntent) => void) | undefined;
    llm.chatWithTools = vi.fn(
      (_personality, _state, _history, _tools, _signal, _context, onStreamEvent) =>
        new Promise<Awaited<ReturnType<ChatTurnLlm['chatWithTools']>>>((resolve) => {
          emit = onStreamEvent;
          finish = (intent) => resolve({ kind: 'reply', intent });
        })
    );
    const { orchestrator, chatEvents, voiceEvents } = createOrchestrator(llm);

    orchestrator.start(baseRequest);
    expect(chatEvents()).toEqual([]);
    await settle();

    emit?.({ type: 'first-speech', speech: '第一段回复。' });
    await settle();
    expect(chatEvents().some((event) => event.type === 'turn-segment')).toBe(false);

    emit?.({ type: 'first-parameters', emotion: 'happy', intensity: 0.4, shortAction: 'agree' });
    await new Promise((resolve) => setTimeout(resolve, 110));
    expect(chatEvents().at(-1)).toMatchObject({
      type: 'turn-segment',
      index: 0,
      message: { text: '第一段回复。' }
    });
    expect(voiceEvents().at(-1)).toMatchObject({
      type: 'reply-stream-start',
      segment: { spokenText: '第一段回复。' }
    });

    finish?.(createIntent());
    await settle();

    expect(
      chatEvents()
        .filter((event) => event.type === 'turn-segment')
        .map((event) => event.message.text)
    ).toEqual(['第一段回复。', '第二段回复。']);
    expect(chatEvents().at(-1)).toMatchObject({ type: 'turn-end', segmentCount: 2 });
    expect(voiceEvents().map((event) => event.type)).toEqual([
      'reply-stream-start',
      'reply-stream-segment',
      'reply-stream-end'
    ]);
  });

  it('resolves scheduler turns through the desktop.sync tool-result round trip', async () => {
    const llm = createLlm(createIntent());
    llm.chatWithTools = vi.fn(async () => ({
      kind: 'tool-call' as const,
      call: {
        name: 'scheduler' as const,
        arguments: {
          action: 'add',
          name: '喝水',
          schedule: { type: 'once', at: Date.now() + 600_000 },
          text: '喝水'
        }
      }
    }));
    const { orchestrator, chatEvents, broadcasts } = createOrchestrator(llm);

    orchestrator.start({ ...baseRequest, message: { ...baseRequest.message, text: '10分钟后提醒我喝水' } });
    await settle();

    const schedulerCommand = broadcasts.find(
      (entry) =>
        entry.topic === 'desktop.sync' && (entry.payload as { type?: string }).type === 'scheduler-command'
    );
    expect(schedulerCommand).toBeDefined();
    const requestId = (schedulerCommand!.payload as { requestId: string }).requestId;

    orchestrator.handleBroadcast('desktop.sync', {
      type: 'tool-result',
      requestId,
      tool: 'scheduler',
      action: 'add',
      success: true,
      speech: '好的，已设置提醒。'
    });
    await settle();

    const chat = chatEvents();
    expect(chat.at(-1)).toMatchObject({ type: 'turn-end', segmentCount: 1 });
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('directly calls the scheduler for a numeric relative reminder', async () => {
    const llm = createLlm(createIntent({ speech: '十秒后来找你！' }));
    const { orchestrator, broadcasts } = createOrchestrator(llm);

    orchestrator.start({ ...baseRequest, message: { ...baseRequest.message, text: '10秒钟后叫我。' } });
    await settle();

    expect(llm.chatWithTools).not.toHaveBeenCalled();
    expect(broadcasts).toContainEqual(
      expect.objectContaining({
        topic: 'desktop.sync',
        payload: expect.objectContaining({
          type: 'scheduler-command',
          input: expect.objectContaining({ schedule: expect.objectContaining({ type: 'once' }) })
        })
      })
    );
  });

  it('directly calls the scheduler for a daily fixed-time reminder', async () => {
    const llm = createLlm(createIntent());
    const { orchestrator, broadcasts } = createOrchestrator(llm);

    orchestrator.start({
      ...baseRequest,
      message: { ...baseRequest.message, text: '每天中午12点提醒我该干饭了。' }
    });
    await settle();

    expect(llm.chatWithTools).not.toHaveBeenCalled();
    expect(broadcasts).toContainEqual(
      expect.objectContaining({
        topic: 'desktop.sync',
        payload: expect.objectContaining({
          type: 'scheduler-command',
          input: expect.objectContaining({
            action: 'add',
            schedule: { type: 'daily', hour: 12, minute: 0 },
            text: '该干饭了。'
          })
        })
      })
    );
  });

  it('directly lists and cancels reminders without relying on the model protocol', async () => {
    const llm = createLlm(createIntent());
    const { orchestrator, broadcasts } = createOrchestrator(llm);

    orchestrator.start({ ...baseRequest, message: { ...baseRequest.message, text: '查看提醒列表' } });
    await settle();
    orchestrator.start({
      ...baseRequest,
      message: { ...baseRequest.message, id: 'cancel', text: '取消喝水提醒' }
    });
    await settle();

    const commands = broadcasts
      .filter((entry) => entry.topic === 'desktop.sync')
      .map((entry) => (entry.payload as { input: unknown }).input);
    expect(llm.chatWithTools).not.toHaveBeenCalled();
    expect(commands).toContainEqual({ action: 'list' });
    expect(commands).toContainEqual({ action: 'remove', query: '喝水' });
  });

  it('directly calls web search for an explicit query', async () => {
    const llm = createLlm(createIntent({ speech: '今天金价不错。' }));
    const networkFetch = vi.fn(
      async () =>
        new Response(
          '<a class="result__a" href="https://example.com/gold">金价</a><a class="result__snippet">金价数据。</a>',
          { status: 200 }
        )
    ) as unknown as typeof fetch;
    const { orchestrator, chatEvents } = createOrchestrator(llm, { networkFetch });

    orchestrator.start({
      ...baseRequest,
      webSearchEnabled: true,
      message: { ...baseRequest.message, text: '帮我搜索今天金价。' }
    });
    await settle();

    expect(llm.chatWithTools).not.toHaveBeenCalled();
    expect(llm.chat).toHaveBeenCalled();
    expect(chatEvents()).toContainEqual(expect.objectContaining({ type: 'turn-phase', searching: true }));
  });

  it('reports an explicit query when web search is disabled without calling the model', async () => {
    const llm = createLlm(createIntent());
    const { orchestrator, chatEvents } = createOrchestrator(llm);

    orchestrator.start({ ...baseRequest, message: { ...baseRequest.message, text: '查询新西天气。' } });
    await settle();

    expect(llm.chatWithTools).not.toHaveBeenCalled();
    expect(chatEvents().at(-1)).toMatchObject({
      type: 'turn-error',
      message: '已收到明确查询请求，但联网搜索未开启。请先在聊天设置中启用联网搜索。'
    });
  });

  it('ends the turn with an error when the tool result never arrives', async () => {
    vi.useFakeTimers();
    try {
      const llm = createLlm(createIntent());
      llm.chatWithTools = vi.fn(async () => ({
        kind: 'tool-call' as const,
        call: { name: 'scheduler' as const, arguments: { action: 'list' } }
      }));
      const { orchestrator, chatEvents } = createOrchestrator(llm);

      orchestrator.start({ ...baseRequest, message: { ...baseRequest.message, text: '10分钟后提醒我喝水' } });
      await vi.advanceTimersByTimeAsync(12_500);

      expect(chatEvents().at(-1)).toMatchObject({
        type: 'turn-error',
        message: expect.stringContaining('桌宠定时服务响应超时')
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports turn-error when the LLM fails', async () => {
    const llm = createLlm(createIntent());
    llm.chatWithTools = vi.fn(async () => {
      throw Object.assign(new Error('LLM 离线'), { rawOutput: '{"speech":"未完成"}' });
    });
    const recordEvent = vi.fn();
    const { orchestrator, chatEvents } = createOrchestrator(llm, { recordEvent });

    orchestrator.start(baseRequest);
    await settle();

    expect(chatEvents().at(-1)).toMatchObject({ type: 'turn-error', message: 'LLM 离线' });
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        details: expect.objectContaining({ rawModelOutput: '{"speech":"未完成"}' })
      })
    );
  });

  it('reports a timeout error when the turn outlives its budget', async () => {
    vi.useFakeTimers();
    try {
      const llm = createLlm(createIntent());
      llm.chatWithTools = vi.fn(
        (_personality, _state, _history, _tools, signal) =>
          new Promise<Awaited<ReturnType<ChatTurnLlm['chatWithTools']>>>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
          })
      );
      const { orchestrator, chatEvents } = createOrchestrator(llm, { turnTimeoutMs: 50 });

      orchestrator.start(baseRequest);
      await vi.advanceTimersByTimeAsync(200);

      expect(chatEvents().at(-1)).toMatchObject({
        type: 'turn-error',
        message: '请求已取消或 LLM 响应超时。'
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('broadcasts turn-cancelled when the turn is aborted', async () => {
    const llm = createLlm(createIntent());
    let releaseChat: (() => void) | undefined;
    llm.chatWithTools = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<ChatTurnLlm['chatWithTools']>>>((_resolve, reject) => {
          releaseChat = () => reject(new DOMException('Aborted', 'AbortError'));
        })
    );
    const { orchestrator, chatEvents } = createOrchestrator(llm);

    const { turnId } = orchestrator.start(baseRequest);
    await settle();
    expect(chatEvents().at(-1)?.type).toBe('turn-start');

    expect(orchestrator.cancel(turnId)).toBe(true);
    releaseChat?.();
    await settle();

    expect(chatEvents().at(-1)).toMatchObject({ type: 'turn-cancelled', turnId });
    expect(orchestrator.cancel(turnId)).toBe(false);
  });
});
