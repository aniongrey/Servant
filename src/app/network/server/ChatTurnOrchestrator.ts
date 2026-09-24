import { randomUUID } from 'node:crypto';
import type { LlmConfig } from '../../../ai/llm/LlmConfig';
import type {
  AssistantIntent,
  AssistantReplySegment,
  AssistantStreamEvent,
  ChatModelResult,
  ChatMessage,
  ChatToolCall,
  ChatToolDefinition,
  PersonalityConfig,
  PersonalityState
} from '../../../ai/llm/types';
import type { WebSearchResult } from '../../../ai/llm/LlmTools';
import { generateValidatedWebSearchAnswer } from '../../../ai/llm/WebSearchAnswer';
import { getSpokenReplySegments } from '../../../ai/tts/resolveConversationSpeech';
import type { SpeechSdkTtsLanguage } from '../../../ai/tts/speechSdkTypes';
import type { TtsEmotionMarkup } from '../../../ai/tts/ttsEmotionMarkup';
import type { SchedulerToolInput, ToolResultEvent } from '../../../scheduler/SchedulerTypes';
import { defaultReplyShortActionId } from '../../../character/motion/reply/shortActionVocabulary';
import { CHAT_TEXT_TOPIC, type ChatStreamEvent } from '../realtime/ChatStreamProtocol';
import { CHAT_DEBUG_TOPIC, type ChatDebugEvent } from '../realtime/ChatDebugProtocol';
import {
  ACTION_VOICE_TOPIC,
  type DesktopReplySegment,
  type VoiceStreamEvent
} from '../realtime/VoiceStreamProtocol';
import type { ChatTurnRequest } from '../realtime/ChatTurnContracts';
import { parseDesktopRealtimeSyncEvent } from '../realtime/DesktopRealtimeSync';
import { createLlmClientFactory, persistAssistantReply, storeUserMessage } from './memoryService';
import { ChatContextBuilder, type BuiltChatContext } from './ChatContextBuilder';
import { ChatToolExecutor, type ChatToolExecutionResult } from './ChatToolExecutor';
import type { ActivityLogRecorder } from '../../logging/ActivityLog';

const SCHEDULER_TIMEOUT_MS = 12_000;
const DEFAULT_TURN_TIMEOUT_MS = 120_000;

/** Aborts a turn that outlived its budget (e.g. a hung LLM connection). */
class TurnTimeoutError extends Error {
  constructor() {
    super('LLM response timeout');
    this.name = 'TurnTimeoutError';
  }
}

/** The LLM surface one chat turn needs; `AiSdkClient` satisfies it structurally. */
export interface ChatTurnLlm {
  chatWithTools(
    personality: PersonalityConfig,
    state: PersonalityState,
    history: readonly ChatMessage[],
    tools: readonly ChatToolDefinition[],
    signal?: AbortSignal,
    contextInstruction?: string,
    onStreamEvent?: (event: AssistantStreamEvent) => void
  ): Promise<ChatModelResult>;
  chat(
    personality: PersonalityConfig,
    state: PersonalityState,
    history: readonly ChatMessage[],
    signal?: AbortSignal,
    contextInstruction?: string,
    onStreamEvent?: (event: AssistantStreamEvent) => void
  ): Promise<AssistantIntent>;
  translateSpeechSegments(
    texts: string[],
    ttsLanguage: SpeechSdkTtsLanguage,
    ttsEmotionMarkup?: TtsEmotionMarkup,
    signal?: AbortSignal
  ): Promise<string[]>;
  getLastRawOutput?(): string | undefined;
}

export interface ChatTurnOrchestratorOptions {
  networkFetch: typeof fetch;
  broadcast: (topic: string, payload?: unknown) => void;
  createLlm?: (config: LlmConfig) => ChatTurnLlm;
  now?: () => number;
  newId?: () => string;
  schedulerTimeoutMs?: number;
  /** Hygiene timeout for a whole turn; the client watchdog is expected to fire first. */
  turnTimeoutMs?: number;
  recordEvent?: ActivityLogRecorder;
}

interface ActiveTurn {
  readonly request: ChatTurnRequest;
  readonly controller: AbortController;
  readonly startedAt: number;
}

/**
 * Runs one chat turn end to end on the server: memory history, LLM, web
 * search, scheduler tools and spoken-text translation. The transport only
 * learns success/failure; the transcript is broadcast on `chat.text` and the
 * spoken segments (text + short actions) on `action.voice`.
 */
export class ChatTurnOrchestrator {
  private readonly activeTurns = new Map<string, ActiveTurn>();
  private readonly schedulerWaiters = new Map<string, (event: ToolResultEvent) => void>();

  private readonly createLlm: (config: LlmConfig) => ChatTurnLlm;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly schedulerTimeoutMs: number;
  private readonly turnTimeoutMs: number;
  private readonly contextBuilder = new ChatContextBuilder();
  private readonly toolExecutor: ChatToolExecutor;

  constructor(private readonly options: ChatTurnOrchestratorOptions) {
    this.createLlm = options.createLlm ?? createLlmClientFactory(options.networkFetch);
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? (() => randomUUID());
    this.schedulerTimeoutMs = options.schedulerTimeoutMs ?? SCHEDULER_TIMEOUT_MS;
    this.turnTimeoutMs = options.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
    this.toolExecutor = new ChatToolExecutor(options.networkFetch);
  }

  start(request: ChatTurnRequest): { turnId: string } {
    const turnId = this.newTurnId();
    const entry: ActiveTurn = { request, controller: new AbortController(), startedAt: this.now() };
    this.activeTurns.set(turnId, entry);
    // Let /api/chat return the turn id before either realtime stream starts.
    queueMicrotask(() => void this.runTurn(turnId, request, entry.controller));
    return { turnId };
  }

  /** Aborts one turn (or every active turn) and broadcasts turn-cancelled. */
  cancel(turnId?: string): boolean {
    const targets = turnId ? [turnId] : [...this.activeTurns.keys()];
    let cancelled = false;
    for (const id of targets) {
      const entry = this.activeTurns.get(id);
      if (!entry) continue;
      cancelled = true;
      // runTurn's abort path broadcasts turn-cancelled and cleans up.
      entry.controller.abort();
    }
    return cancelled;
  }

  /** Feed gateway broadcasts back in so scheduler tool results can resolve. */
  handleBroadcast(topic: string, payload: unknown): void {
    if (topic !== 'desktop.sync') return;
    const event = parseDesktopRealtimeSyncEvent(payload);
    if (event?.type !== 'tool-result' || event.tool !== 'scheduler') return;
    this.schedulerWaiters.get(event.requestId)?.(event);
  }

  private newTurnId(): string {
    return `turn-${this.newId()}`;
  }

  private async runTurn(
    turnId: string,
    request: ChatTurnRequest,
    controller: AbortController
  ): Promise<void> {
    const signal = controller.signal;
    const timeoutTimer = setTimeout(() => controller.abort(new TurnTimeoutError()), this.turnTimeoutMs);
    const broadcastChat = (event: ChatStreamEvent) => this.options.broadcast(CHAT_TEXT_TOPIC, event);
    const broadcastVoice = (event: VoiceStreamEvent) => this.options.broadcast(ACTION_VOICE_TOPIC, event);
    const broadcastDebug = (event: ChatDebugEvent) => this.options.broadcast(CHAT_DEBUG_TOPIC, event);
    try {
      this.options.recordEvent?.({
        channel: 'chat',
        status: 'start',
        message: '聊天轮次开始',
        turnId,
        details: { id: turnId, userMessage: request.message }
      });
      broadcastChat({ type: 'turn-start', turnId, userMessage: request.message });
      const llm = this.createLlm(request.llmConfig);
      if (!request.internal) void storeUserMessage(request.message);
      const context = await this.contextBuilder.build(request, signal);
      this.options.recordEvent?.({
        channel: 'memory',
        status: 'success',
        message: `记忆上下文读取完成 · ${context.debug.memory.entries.length} 条`,
        turnId,
        details: { query: context.debug.memory.query, count: context.debug.memory.entries.length }
      });
      broadcastDebug({
        type: 'context',
        turnId,
        at: this.now(),
        input: {
          text: context.input.text,
          toolCandidates: context.input.toolCandidates,
          requiresSchedulerTool: context.input.requiresSchedulerTool,
          requiresWebSearchTool: context.input.requiresWebSearchTool
        },
        tools: context.tools.map(({ name }) => ({ name })),
        memory: context.debug.memory,
        ...(context.debug.currentTime ? { currentTime: context.debug.currentTime } : {})
      });
      const streamedMessages: ChatMessage[] = [];
      let firstParameters: Pick<AssistantReplySegment, 'emotion' | 'intensity' | 'shortAction'> | undefined;
      let firstSpeechPreparation:
        | Promise<Array<AssistantReplySegment & { spokenText: string; text: string }>>
        | undefined;
      let firstDeliveryScheduled = false;
      let delivery = Promise.resolve();
      const scheduleFirstDelivery = () => {
        const preparation = firstSpeechPreparation;
        if (!preparation || firstDeliveryScheduled) return;
        firstDeliveryScheduled = true;
        delivery = delivery.then(async () => {
          const [prepared] = await preparation;
          const parameters = await pollForValue(() => firstParameters, signal);
          if (!prepared) throw new Error('首段回复没有可播放的文本。');
          const segment = { ...prepared, ...parameters };
          streamedMessages.push(
            this.broadcastReplySegment(
              turnId,
              segment,
              streamedMessages.length,
              broadcastChat,
              broadcastVoice
            )
          );
        });
        void delivery.catch(() => undefined);
      };
      const onStreamEvent = (event: AssistantStreamEvent) => {
        if (event.type === 'first-speech' && !firstSpeechPreparation) {
          this.options.recordEvent?.({
            channel: 'chat',
            status: 'info',
            message: '首段台词已截断',
            turnId,
            details: { userMessage: request.message, speech: event.speech }
          });
          firstSpeechPreparation = this.collectReplySegments(
            request,
            [
              {
                speech: event.speech,
                emotion: 'neutral',
                intensity: 0.5,
                shortAction: defaultReplyShortActionId
              }
            ],
            llm,
            signal
          );
          scheduleFirstDelivery();
        }
        if (event.type === 'first-parameters') {
          firstParameters = event;
          this.options.recordEvent?.({
            channel: 'chat',
            status: 'info',
            message: '首段参数已截断',
            turnId,
            details: {
              userMessage: request.message,
              emotion: event.emotion,
              intensity: event.intensity,
              shortAction: event.shortAction
            }
          });
          scheduleFirstDelivery();
        }
      };
      const { intent, sources } = await this.resolveIntent(
        turnId,
        request,
        llm,
        context,
        signal,
        onStreamEvent,
        broadcastDebug
      );
      broadcastChat({ type: 'turn-phase', turnId, searching: false });

      if (firstSpeechPreparation) {
        await delivery;
        const remaining = await this.collectReplySegments(request, intent.replies.slice(1), llm, signal);
        for (const segment of remaining) {
          streamedMessages.push(
            this.broadcastReplySegment(
              turnId,
              segment,
              streamedMessages.length,
              broadcastChat,
              broadcastVoice
            )
          );
        }
        this.finishStreamedReply(turnId, request, intent, streamedMessages, broadcastChat, broadcastVoice);
      } else {
        const segments = await this.collectReplySegments(request, intent.replies, llm, signal);
        this.broadcastReplySegments(
          turnId,
          request,
          intent,
          sources,
          segments,
          broadcastChat,
          broadcastVoice
        );
      }
      this.options.recordEvent?.({
        channel: 'chat',
        status: 'success',
        message: '聊天轮次完成',
        turnId,
        details: {
          id: turnId,
          userMessage: request.message,
          reply: intent,
          ...(llm.getLastRawOutput?.() ? { rawModelOutput: llm.getLastRawOutput() } : {}),
          replyContext: context,
          sources
        }
      });
    } catch (cause) {
      this.options.recordEvent?.({
        channel: 'chat',
        status: signal.aborted ? 'info' : 'error',
        message: signal.aborted ? '聊天轮次已取消' : '聊天轮次失败',
        turnId,
        details: {
          id: turnId,
          userMessage: request.message,
          error: cause instanceof Error ? cause.message : String(cause),
          ...(readRawModelOutput(cause) ? { rawModelOutput: readRawModelOutput(cause) } : {})
        }
      });
      if (signal.aborted && signal.reason instanceof TurnTimeoutError) {
        this.options.broadcast(CHAT_TEXT_TOPIC, {
          type: 'turn-error',
          turnId,
          message: '请求已取消或 LLM 响应超时。'
        });
      } else if (signal.aborted) {
        this.options.broadcast(CHAT_TEXT_TOPIC, { type: 'turn-cancelled', turnId });
      } else {
        broadcastDebug({
          type: 'error',
          turnId,
          at: this.now(),
          message: cause instanceof Error ? cause.message : 'AI SDK request failed'
        });
        this.options.broadcast(CHAT_TEXT_TOPIC, {
          type: 'turn-error',
          turnId,
          message: cause instanceof Error ? cause.message : 'AI SDK request failed'
        });
      }
    } finally {
      clearTimeout(timeoutTimer);
      if (!signal.aborted) controller.abort();
      this.activeTurns.delete(turnId);
    }
  }

  private async resolveIntent(
    turnId: string,
    request: ChatTurnRequest,
    llm: ChatTurnLlm,
    context: BuiltChatContext,
    signal: AbortSignal,
    onStreamEvent?: (event: AssistantStreamEvent) => void,
    broadcastDebug?: (event: ChatDebugEvent) => void
  ): Promise<{ intent: AssistantIntent; sources: WebSearchResult[] }> {
    if (context.input.requiresWebSearchTool && !request.webSearchEnabled) {
      throw new Error('已收到明确查询请求，但联网搜索未开启。请先在聊天设置中启用联网搜索。');
    }
    let first: ChatModelResult;
    const ttsInstruction = request.ttsEmotionMarkup
      ? `当前 TTS 需要语音情感标签（${request.ttsEmotionMarkup}）。每个 replies 元素必须额外返回 ttsEmotion 字段，值只写标签正文，不含方括号；Fish S2 使用英文标签如 sad、happy、sobbing，豆包 2.0 使用中文语气标签如 开心地说、忍不住啜泣。`
      : '';
    const llmInstruction = [context.instruction, ttsInstruction].filter(Boolean).join('\n');
    try {
      first =
        this.createDirectToolCall(context, request) ??
        (await llm.chatWithTools(
          request.personality,
          request.personalityState,
          context.history,
          context.tools,
          signal,
          llmInstruction,
          onStreamEvent
        ));
    } catch (cause) {
      this.recordLlmValidationFailure(turnId, context, cause);
      throw cause;
    }
    const requiredTool = context.input.requiresSchedulerTool
      ? 'scheduler'
      : context.input.requiresWebSearchTool && request.webSearchEnabled
      ? 'web-search'
      : undefined;
    if (requiredTool && (first.kind !== 'tool-call' || first.call.name !== requiredTool)) {
      throw new Error(
        requiredTool === 'scheduler'
          ? '明确提醒请求未触发定时工具，已拒绝发送口头承诺。'
          : '明确查询请求未触发联网查询工具，已拒绝发送未经查询的回复。'
      );
    }
    if (first.kind === 'reply') return { intent: first.intent, sources: [] };

    broadcastDebug?.({ type: 'tool-call', turnId, at: this.now(), call: first.call });
    this.options.recordEvent?.({
      channel: first.call.name,
      status: 'start',
      message: first.call.name === 'web-search' ? '开始联网搜索' : '开始执行定时操作',
      turnId,
      details: { arguments: first.call.arguments }
    });

    if (first.call.name === 'web-search') {
      this.options.broadcast(CHAT_TEXT_TOPIC, { type: 'turn-phase', turnId, searching: true });
    }
    let toolResult: ChatToolExecutionResult;
    try {
      toolResult = await this.toolExecutor.execute(first.call, {
        available: context.tools,
        userText: context.input.text,
        signal,
        requestScheduler: (input) => this.requestSchedulerTool(`scheduler-${this.newId()}`, input, signal)
      });
    } catch (cause) {
      this.options.recordEvent?.({
        channel: first.call.name,
        status: 'error',
        message: first.call.name === 'web-search' ? '联网搜索失败' : '定时操作失败',
        turnId,
        details: { error: cause instanceof Error ? cause.message : String(cause) }
      });
      throw cause;
    }
    this.options.recordEvent?.({
      channel: toolResult.name,
      status: 'success',
      message:
        toolResult.name === 'web-search'
          ? `联网搜索完成 · ${toolResult.sources.length} 个来源`
          : '定时操作完成',
      turnId,
      details: toolResult.debug
    });
    broadcastDebug?.({
      type: 'tool-result',
      turnId,
      at: this.now(),
      tool: toolResult.name,
      details: toolResult.debug
    });
    const continuation = [context.continuationInstruction, toolResult.instruction]
      .filter(Boolean)
      .join('\n\n');
    if (toolResult.name === 'web-search') {
      const intent = await generateValidatedWebSearchAnswer(
        toolResult.question,
        continuation,
        (nextContext) =>
          llm.chat(request.personality, request.personalityState, context.history, signal, nextContext).catch(
            (cause) => {
              this.recordLlmValidationFailure(turnId, context, cause);
              throw cause;
            }
          ),
        toolResult.sources
      );
      return { intent, sources: toolResult.sources };
    }
    return { intent: schedulerToolIntent(toolResult.speech), sources: [] };
  }

  private recordLlmValidationFailure(turnId: string, context: BuiltChatContext, cause: unknown): void {
    const rawOutput = cause instanceof Error ? (cause as Error & { rawOutput?: unknown }).rawOutput : undefined;
    if (typeof rawOutput !== 'string') return;
    this.options.recordEvent?.({
      channel: 'chat',
      status: 'error',
      message: cause instanceof Error ? cause.message : 'LLM 输出校验失败',
      turnId,
      details: {
        messageId: [...context.history].reverse().find((message) => message.role === 'user')?.id,
        rawModelOutput: rawOutput
      }
    });
  }

  private async collectReplySegments(
    request: ChatTurnRequest,
    replies: readonly AssistantReplySegment[],
    llm: ChatTurnLlm,
    signal: AbortSignal
  ): Promise<Array<AssistantReplySegment & { spokenText: string; text: string }>> {
    const spoken = await getSpokenReplySegments(
      llm,
      replies,
      request.ttsLanguage,
      request.ttsEmotionMarkup,
      signal
    );
    const segments = spoken
      .map((reply) => ({ ...reply, text: reply.speech.trim() }))
      .filter((reply) => reply.text);
    //if (segments.length === 0) throw new Error('LLM 回复中没有可显示的文本。');
    return segments;
  }

  /** Explicit commands do not depend on a model reproducing the tool-tag protocol. */
  private createDirectToolCall(
    context: BuiltChatContext,
    request: ChatTurnRequest
  ): ChatModelResult | undefined {
    if (context.input.requiresWebSearchTool && request.webSearchEnabled) {
      const query = context.input.text
        .replace(/^(?:请|帮我)?(?:搜索|搜一下|查一下|查询|联网(?:查询|搜索)|网上(?:查|搜))\s*/u, '')
        .trim();
      return {
        kind: 'tool-call',
        call: {
          name: 'web-search',
          arguments: { query: query || context.input.text, resolvedQuestion: context.input.text }
        }
      };
    }
    if (
      /(?:查看|列出|显示|看看).{0,8}(?:提醒|闹钟)(?:列表|清单)?|(?:提醒|闹钟).{0,8}(?:列表|清单|有哪些)/u.test(
        context.input.text
      )
    ) {
      return { kind: 'tool-call', call: { name: 'scheduler', arguments: { action: 'list' } } };
    }
    const remove = context.input.text.match(/(?:取消|删除|移除)\s*(.+?)(?:提醒|闹钟)\s*[。！!？?]*$/u);
    if (remove) {
      const query = remove[1].trim();
      return {
        kind: 'tool-call',
        call: { name: 'scheduler', arguments: { action: 'remove', ...(query ? { query } : {}) } }
      };
    }
    const daily = context.input.text.match(
      /^每天(?:早上|上午|中午|下午|晚上)?\s*(\d{1,2})(?:点|:)(?:(\d{1,2})分?)?(?:钟)?(?:提醒我|叫我)(.*)$/u
    );
    if (daily) {
      const hour = Number(daily[1]);
      const minute = Number(daily[2] ?? 0);
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        const detail = daily[3].replace(/^[，,。！!\s]*(?:提醒我)?/u, '').trim();
        return {
          kind: 'tool-call',
          call: {
            name: 'scheduler',
            arguments: {
              action: 'add',
              name: detail ? `提醒：${detail.slice(0, 40)}` : '每日提醒',
              schedule: { type: 'daily', hour, minute },
              text: detail || '时间到了，提醒你。'
            }
          }
        };
      }
    }
    const match = context.input.text.match(
      /(\d+(?:\.\d+)?)\s*(秒钟?|分钟|小时)后(?:再)?(?:叫我|提醒我)(.*)$/u
    );
    if (!match) return undefined;
    const unitMs = match[2].startsWith('秒') ? 1_000 : match[2] === '分钟' ? 60_000 : 3_600_000;
    const detail = match[3].replace(/^[，,。！!\s]*(?:提醒我)?/u, '').trim();
    const call: ChatToolCall = {
      name: 'scheduler',
      arguments: {
        action: 'add',
        name: detail ? `提醒：${detail.slice(0, 40)}` : '提醒',
        schedule: { type: 'once', at: this.now() + Math.round(Number(match[1]) * unitMs) },
        text: detail || '时间到了，提醒你。'
      }
    };
    return { kind: 'tool-call', call };
  }

  private broadcastReplySegment(
    turnId: string,
    segment: AssistantReplySegment & { spokenText: string; text: string },
    index: number,
    broadcastChat: (event: ChatStreamEvent) => void,
    broadcastVoice: (event: VoiceStreamEvent) => void
  ): ChatMessage {
    const message: ChatMessage = {
      id: this.newId(),
      role: 'assistant',
      text: segment.text,
      createdAt: this.now() + index
    };
    broadcastChat({
      type: 'turn-segment',
      turnId,
      index,
      message,
      emotion: segment.emotion,
      intensity: segment.intensity,
      shortAction: segment.shortAction
    });
    broadcastVoice(
      index === 0
        ? {
            type: 'reply-stream-start',
            id: turnId,
            segment: toVoiceSegment(segment),
            source: 'conversation'
          }
        : {
            type: 'reply-stream-segment',
            id: turnId,
            index,
            segment: toVoiceSegment(segment),
            source: 'conversation'
          }
    );
    return message;
  }

  private finishStreamedReply(
    turnId: string,
    request: ChatTurnRequest,
    intent: AssistantIntent,
    messages: ChatMessage[],
    broadcastChat: (event: ChatStreamEvent) => void,
    broadcastVoice: (event: VoiceStreamEvent) => void
  ): void {
    broadcastVoice({
      type: 'reply-stream-end',
      id: turnId,
      segmentCount: messages.length,
      source: 'conversation'
    });
    broadcastChat({
      type: 'turn-end',
      turnId,
      segmentCount: messages.length,
      meta: {
        soulEvent: intent.soulEvent,
        searching: false
      }
    });
    if (!request.internal) void persistAssistantReply(request, intent, messages);
  }

  private broadcastReplySegments(
    turnId: string,
    request: ChatTurnRequest,
    intent: AssistantIntent,
    webResults: WebSearchResult[],
    segments: Array<AssistantReplySegment & { spokenText: string; text: string }>,
    broadcastChat: (event: ChatStreamEvent) => void,
    broadcastVoice: (event: VoiceStreamEvent) => void
  ): void {
    const usedSources = webResults.length
      ? webResults
          .filter(({ url }) => intent.sourceUrls?.includes(url) || intent.speech.includes(url))
          .map(({ title, url, snippet }) => ({ title, url, snippet }))
      : [];
    const searching = usedSources.length > 0;
    const messages: ChatMessage[] = [];
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const message: ChatMessage = {
        id: this.newId(),
        role: 'assistant',
        text: segment.text,
        createdAt: this.now() + index,
        ...(searching && index === segments.length - 1
          ? { kind: 'web-search' as const, sources: usedSources }
          : {})
      };
      messages.push(message);
      broadcastChat({
        type: 'turn-segment',
        turnId,
        index,
        message,
        emotion: segment.emotion,
        intensity: segment.intensity,
        shortAction: segment.shortAction
      });
      broadcastVoice(
        index === 0
          ? {
              type: 'reply-stream-start',
              id: turnId,
              segment: toVoiceSegment(segment),
              source: 'conversation'
            }
          : {
              type: 'reply-stream-segment',
              id: turnId,
              index,
              segment: toVoiceSegment(segment),
              source: 'conversation'
            }
      );
    }
    broadcastVoice({
      type: 'reply-stream-end',
      id: turnId,
      segmentCount: segments.length,
      source: 'conversation'
    });
    broadcastChat({
      type: 'turn-end',
      turnId,
      segmentCount: segments.length,
      meta: {
        soulEvent: intent.soulEvent,
        searching
      }
    });
    if (!request.internal) void persistAssistantReply(request, intent, messages);
  }

  private requestSchedulerTool(
    requestId: string,
    input: SchedulerToolInput,
    signal: AbortSignal
  ): Promise<ToolResultEvent> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        this.schedulerWaiters.delete(requestId);
        signal.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      this.schedulerWaiters.set(requestId, (event) => {
        cleanup();
        resolve(event);
      });
      timer = setTimeout(() => {
        cleanup();
        reject(new Error('桌宠定时服务响应超时，请确认 pages/desktop.html 已启动。'));
      }, this.schedulerTimeoutMs);
      signal.addEventListener('abort', onAbort, { once: true });
      this.options.broadcast('desktop.sync', { type: 'scheduler-command', requestId, input });
    });
  }
}

function toVoiceSegment(
  segment: AssistantReplySegment & { spokenText: string; text: string }
): DesktopReplySegment {
  return {
    text: segment.text,
    spokenText: segment.spokenText,
    emotion: segment.emotion,
    intensity: segment.intensity,
    shortAction: segment.shortAction
  };
}

function schedulerToolIntent(speech: string): AssistantIntent {
  const reply = {
    speech,
    emotion: 'neutral' as const,
    intensity: 0.4,
    shortAction: defaultReplyShortActionId
  };
  return {
    replies: [reply],
    speech,
    soulEvent: 'chat',
    emotion: 'neutral',
    intensity: 0.4,
    memories: []
  };
}

async function pollForValue<T>(read: () => T | undefined, signal: AbortSignal): Promise<T> {
  while (read() === undefined) {
    signal.throwIfAborted();
    await wait(100, signal);
  }
  return read()!;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    const abort = () => done(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    function done(error?: unknown) {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

function readRawModelOutput(cause: unknown): string | undefined {
  if (!(cause instanceof Error) || !('rawOutput' in cause)) return undefined;
  const rawOutput = (cause as Error & { rawOutput?: unknown }).rawOutput;
  return typeof rawOutput === 'string' ? rawOutput.slice(0, 20_000) : undefined;
}
