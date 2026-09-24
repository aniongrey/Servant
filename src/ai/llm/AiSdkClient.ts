import { generateText, Output, streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createCohere } from '@ai-sdk/cohere';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import { createOllama } from 'ollama-ai-provider-v2';
import { z } from 'zod';
import { translateSpeechSegmentsWithMyMemory } from '../tts/MyMemoryTranslator';
import { getLlmProviderOption, llmModelSupportsTemperature, type LlmConfig } from './LlmConfig';
import { createWebSearchSummaryFollowUp } from './WebSearchAnswer';
import {
  MEMOIR_CATEGORIES,
  type AssistantIntent,
  type AssistantReplySegment,
  type AssistantStreamEvent,
  type ChatModelResult,
  type ChatMessage,
  type ChatToolCall,
  type ChatToolDefinition,
  type ExtractedMemoryCandidate,
  type LlmModelInfo,
  type MemoryCandidate,
  MEMORY_TYPES,
  PERSONALITY_MOODS,
  type PersonalityConfig,
  type PersonalityMood,
  type PersonalityState,
  type SpeechOutputLanguage
} from './types';
import { SOUL_EVENT_TYPES, type SoulEventType } from '../../soul/types';
import {
  defaultReplyShortActionId,
  replyShortActionIds,
  resolveReplyShortActionId
} from '../../character/motion/reply/shortActionVocabulary';
import type { TtsEmotionMarkup } from '../tts/ttsEmotionMarkup';
import { LlmOutputPreprocessor } from './LlmOutputPreprocessor';

const OLLAMA_NUM_CTX = 8192;

const extractedMemorySchema = z.object({
  memoryType: z.enum(MEMORY_TYPES),
  summary: z.string().min(1).max(500),
  people: z.array(z.string().min(1).max(80)).max(10),
  keywords: z.array(z.string().min(1).max(80)).max(10),
  eventTimeStart: z.string().datetime({ offset: true }).nullable(),
  eventTimeEnd: z.string().datetime({ offset: true }).nullable(),
  importance: z.number().min(0).max(1),
  sourceMessageIds: z.array(z.string().uuid()).min(1).max(50)
});

export interface LlmDiagnostic {
  stage: 'model';
  milliseconds: number;
}

export interface MainLlmDebugSink {
  writeRequest(request: {
    system: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    temperature?: number;
    providerOptions?: unknown;
  }): void;
  writeResponse(raw: string): void;
}

export class AiSdkClient {
  private readonly outputPreprocessor = new LlmOutputPreprocessor();
  private lastRawOutput?: string;

  constructor(
    private readonly config: LlmConfig,
    private readonly networkFetch: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
    private readonly onDiagnostic?: (event: LlmDiagnostic) => void,
    private readonly mainLlmDebug?: MainLlmDebugSink
  ) {}

  getLastRawOutput(): string | undefined {
    return this.lastRawOutput;
  }

  async listModels(signal?: AbortSignal): Promise<LlmModelInfo[]> {
    if (this.config.provider !== 'ollama') {
      return getLlmProviderOption(this.config.provider).models.map((model) => ({ name: model, model }));
    }

    const response = await this.networkFetch('/api/ollama/tags', { signal });
    if (!response.ok) {
      throw new Error(`LLM provider unavailable (${response.status})`);
    }
    const body = (await response.json()) as { models?: LlmModelInfo[] };
    return body.models ?? [];
  }

  async testConnection(signal?: AbortSignal): Promise<void> {
    if (this.config.provider === 'ollama') {
      const models = await this.listModels(signal);
      if (!models.some((model) => model.model === this.config.model || model.name === this.config.model)) {
        throw new Error(`Ollama 已连接，但未找到模型 ${this.config.model}。`);
      }
      return;
    }

    await generateText({
      model: this.createModel(),
      prompt: 'Reply with OK.',
      maxOutputTokens: 8,
      abortSignal: signal
    });
  }

  async extractDailyMemories(
    messages: readonly Pick<ChatMessage, 'id' | 'role' | 'text' | 'createdAt'>[],
    signal?: AbortSignal
  ): Promise<ExtractedMemoryCandidate[]> {
    if (!messages.some((message) => message.role === 'user')) return [];
    const result = await generateText({
      model: this.createModel(),
      system: [
        '从昨天的对话中提取未来仍有帮助的独立长期记忆，不要回答用户。',
        '只记录用户明确表达的资料、偏好、关系、重要事件和计划；不记录寒暄、助手推测、密码、令牌、证件号、支付信息或精确住址。',
        '每条记忆必须引用输入中真实存在的消息 id。无法确定的时间填 null。相同事实只保留一条。'
      ].join('\n'),
      prompt: JSON.stringify(messages),
      output: Output.object({ schema: z.object({ memories: z.array(extractedMemorySchema).max(30) }) }),
      temperature: 0,
      providerOptions:
        this.config.provider === 'ollama'
          ? { ollama: { think: false, options: { num_ctx: OLLAMA_NUM_CTX } } }
          : undefined,
      abortSignal: signal
    });
    const allowedIds = new Set(messages.map((message) => message.id));
    return result.output.memories.filter((memory) =>
      memory.sourceMessageIds.every((id) => allowedIds.has(id))
    );
  }

  async chat(
    personality: PersonalityConfig,
    state: PersonalityState,
    history: readonly ChatMessage[],
    signal?: AbortSignal,
    contextInstruction?: string,
    onStreamEvent?: (event: AssistantStreamEvent) => void
  ): Promise<AssistantIntent> {
    const factualSummary = createWebSearchSummaryFollowUp(history);
    if (factualSummary) return factualSummary;
    let attempt = 0;
    const intent = await this.outputPreprocessor.process(
      () =>
        this.streamChat(
          personality,
          state,
          history,
          signal,
          contextInstruction,
          ++attempt === 1 ? onStreamEvent : undefined
        ),
      (raw) => {
        this.lastRawOutput = raw;
        return this.outputPreprocessor.processAssistant(raw);
      }
    );
    onStreamEvent?.({ type: 'intent', intent });
    return intent;
  }

  async chatWithTools(
    personality: PersonalityConfig,
    state: PersonalityState,
    history: readonly ChatMessage[],
    tools: readonly ChatToolDefinition[],
    signal?: AbortSignal,
    contextInstruction?: string,
    onStreamEvent?: (event: AssistantStreamEvent) => void
  ): Promise<ChatModelResult> {
    const factualSummary = createWebSearchSummaryFollowUp(history);
    if (factualSummary) return { kind: 'reply', intent: factualSummary };
    let attempt = 0;
    const result = await this.outputPreprocessor.process(
      () =>
        this.streamChat(
          personality,
          state,
          history,
          signal,
          contextInstruction,
          ++attempt === 1 ? onStreamEvent : undefined
        ),
      (raw) => {
        this.lastRawOutput = raw;
        const call = parseChatToolCall(raw, tools);
        if (call) return { kind: 'tool-call' as const, call };
        return {
          kind: 'reply' as const,
          intent: this.outputPreprocessor.processAssistant(raw)
        };
      }
    );
    if (result.kind === 'reply') onStreamEvent?.({ type: 'intent', intent: result.intent });
    return result;
  }

  private async streamChat(
    personality: PersonalityConfig,
    state: PersonalityState,
    history: readonly ChatMessage[],
    signal?: AbortSignal,
    contextInstruction?: string,
    onStreamEvent?: (event: AssistantStreamEvent) => void
  ): Promise<string> {
    const model = this.createModel();
    const modelStartedAt = performance.now();
    const system = [buildSystemPrompt(personality, state), contextInstruction].filter(Boolean).join('\n');
    const messages = history.slice(-8).map((message) => ({ role: message.role, content: message.text }));
    const temperature = this.requestTemperature();
    const providerOptions =
      this.config.provider === 'ollama'
        ? { ollama: { think: false, options: { num_ctx: OLLAMA_NUM_CTX } } }
        : undefined;
    this.mainLlmDebug?.writeRequest({ system, messages, temperature, providerOptions });
    let streamError: unknown;
    const result = streamText({
      model,
      system,
      messages,
      temperature,
      providerOptions,
      abortSignal: signal,
      onError: ({ error }) => {
        streamError = error;
      }
    });
    let raw = '';
    let emittedFirstSpeech = false;
    let emittedFirstParameters = false;
    for await (const delta of result.textStream) {
      raw += delta;
      const partial = parsePrioritizedAssistantOutput(raw);
      if (partial.firstSpeech && !emittedFirstSpeech) {
        emittedFirstSpeech = true;
        onStreamEvent?.({ type: 'first-speech', speech: partial.firstSpeech });
      }
      if (partial.firstParameters && !emittedFirstParameters) {
        emittedFirstParameters = true;
        onStreamEvent?.({ type: 'first-parameters', ...partial.firstParameters });
      }
    }
    this.mainLlmDebug?.writeResponse(raw);
    if (streamError) throw toError(streamError, 'AI SDK stream failed');
    this.onDiagnostic?.({ stage: 'model', milliseconds: performance.now() - modelStartedAt });
    return raw;
  }

  async translateSpeech(
    speech: string,
    speechOutputLanguage: SpeechOutputLanguage,
    signal?: AbortSignal
  ): Promise<string> {
    return (
      (await this.translateSpeechSegments([speech], speechOutputLanguage, undefined, signal))[0] ?? speech
    );
  }

  async translateSpeechSegments(
    speeches: readonly string[],
    speechOutputLanguage: SpeechOutputLanguage,
    ttsEmotionMarkup?: TtsEmotionMarkup,
    signal?: AbortSignal
  ): Promise<string[]> {
    return translateSpeechSegmentsWithMyMemory(speeches, speechOutputLanguage, ttsEmotionMarkup, signal);
  }

  private createModel() {
    switch (this.config.provider) {
      case 'openai':
        return createOpenAI({
          apiKey: requireApiKey(this.config),
          fetch: this.networkFetch
        })(this.config.model);
      case 'anthropic':
        return createAnthropic({
          apiKey: requireApiKey(this.config),
          fetch: this.networkFetch
        })(this.config.model);
      case 'google':
        return createGoogleGenerativeAI({
          apiKey: requireApiKey(this.config),
          fetch: this.networkFetch
        })(this.config.model);
      case 'xai':
        return createXai({
          apiKey: requireApiKey(this.config),
          fetch: this.networkFetch
        })(this.config.model);
      case 'mistral':
        return createMistral({
          apiKey: requireApiKey(this.config),
          fetch: this.networkFetch
        })(this.config.model);
      case 'groq':
        return createGroq({
          apiKey: requireApiKey(this.config),
          fetch: this.networkFetch
        })(this.config.model);
      case 'deepseek':
        return createDeepSeek({
          apiKey: requireApiKey(this.config),
          fetch: this.networkFetch
        })(this.config.model);
      case 'cohere':
        return createCohere({
          apiKey: requireApiKey(this.config),
          fetch: this.networkFetch
        })(this.config.model);
      case 'doubao':
        return createOpenAI({
          apiKey: requireApiKey(this.config),
          baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
          fetch: this.networkFetch,
          name: 'doubao'
        })(this.config.model);
      case 'ollama':
      default:
        return createOllama({
          baseURL: '/api/ollama',
          compatibility: 'strict',
          fetch: this.networkFetch
        })(this.config.model);
    }
  }

  private requestTemperature(): number | undefined {
    return llmModelSupportsTemperature(this.config) ? this.config.temperature : undefined;
  }
}

function requireApiKey(config: LlmConfig): string {
  const apiKey = config.apiKey.trim();
  if (!apiKey) throw new Error(`${getLlmProviderOption(config.provider).label} API Key 未配置。`);
  return apiKey;
}

export function parseChatToolCall(
  raw: string,
  available: readonly ChatToolDefinition[]
): ChatToolCall | undefined {
  const match = raw.trim().match(/^<tool_call>\s*([\s\S]*?)\s*<\/tool_call>$/i);
  if (!match) {
    if (/<\/?tool_call\b/i.test(raw)) throw new Error('LLM 返回了不完整的工具调用。');
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(match[1]);
  } catch {
    throw new Error('LLM 返回的工具参数不是合法 JSON。');
  }
  if (!value || typeof value !== 'object') throw new Error('LLM 返回的工具调用无效。');
  const call = value as Partial<ChatToolCall>;
  if (
    !available.some(({ name }) => name === call.name) ||
    !call.arguments ||
    typeof call.arguments !== 'object' ||
    Array.isArray(call.arguments)
  ) {
    throw new Error('LLM 请求了不可用或无效的工具。');
  }
  return { name: call.name!, arguments: call.arguments as Record<string, unknown> };
}

export function validateAssistantIntent(raw: unknown): AssistantIntent {
  const fallbackReplies: AssistantReplySegment[] = [
    {
      speech: '我刚才走神了，可以再说一次吗？',
      emotion: 'neutral',
      intensity: 0.3,
      shortAction: defaultReplyShortActionId
    }
  ];
  const fallback: AssistantIntent = {
    replies: fallbackReplies,
    speech: fallbackReplies[0].speech,
    emotion: 'neutral',
    soulEvent: 'chat',
    intensity: 0.3,
    memories: []
  };

  try {
    const parsed =
      typeof raw === 'string'
        ? (JSON.parse(extractJsonObject(raw)) as Partial<AssistantIntent>)
        : (raw as Partial<AssistantIntent>);
    const replies = normalizeAssistantReplies(parsed);
    if (replies.length === 0) return fallback;
    const speech = replies.map((reply) => reply.speech).join('\n');
    const finalReply = replies.at(-1)!;
    const soulEvent = SOUL_EVENT_TYPES.includes(parsed.soulEvent as SoulEventType)
      ? (parsed.soulEvent as SoulEventType)
      : 'chat';
    const memories = normalizeMemoryCandidates(parsed.memories);
    return {
      replies,
      speech,
      soulEvent,
      emotion: finalReply.emotion,
      intensity: finalReply.intensity,
      memories
    };
  } catch {
    return fallback;
  }
}

export interface PrioritizedAssistantOutput {
  firstSpeech?: string;
  firstParameters?: Pick<AssistantReplySegment, 'emotion' | 'intensity' | 'shortAction' | 'ttsEmotion'>;
  intent?: Partial<AssistantIntent>;
}

export class AssistantProtocolError extends Error {
  constructor(message: string, readonly rawOutput: string) {
    super(message);
    this.name = 'AssistantProtocolError';
  }
}

export function parsePrioritizedAssistantOutput(raw: string, final = false): PrioritizedAssistantOutput {
  const objects = extractLeadingJsonObjects(raw, 3);
  const first = readJsonRecord(objects[0]);
  const firstSpeech = typeof first?.speech === 'string' ? sanitizeAssistantSpeech(first.speech) : '';
  const second = readJsonRecord(objects[1]);
  // Some local models merge the first two protocol objects despite the prompt.
  // Accept that complete first segment so the stream never waits for parameters
  // that were already returned.
  const firstParameters = readFirstParameters(second) ?? readFirstParameters(first);
  if (!final) {
    return {
      ...(firstSpeech ? { firstSpeech } : {}),
      ...(firstParameters ? { firstParameters } : {})
    };
  }
  const intent = readJsonRecord(objects[2]) ?? (Array.isArray(second?.replies) ? second : undefined);
  if (!firstSpeech || !firstParameters || !intent) {
    throw new AssistantProtocolError('LLM 返回的优先回复协议不完整。', raw);
  }
  const rawReplies = Array.isArray(intent.replies) ? intent.replies : [];
  return {
    firstSpeech,
    firstParameters,
    intent: {
      ...intent,
      replies: [
        {
          speech: firstSpeech,
          ...firstParameters
        },
        ...rawReplies
      ]
    }
  };
}

function normalizeAssistantReplies(parsed: Partial<AssistantIntent>): AssistantReplySegment[] {
  const rawReplies = Array.isArray(parsed.replies)
    ? parsed.replies
    : typeof parsed.speech === 'string'
    ? [{ speech: parsed.speech, shortAction: defaultReplyShortActionId }]
    : [];
  const replies: AssistantReplySegment[] = [];
  for (const raw of rawReplies) {
    if (!raw || typeof raw !== 'object') continue;
    const candidate = raw as Partial<AssistantReplySegment>;
    const speech = typeof candidate.speech === 'string' ? sanitizeAssistantSpeech(candidate.speech) : '';
    if (!speech) continue;
    replies.push({
      speech,
      ...(typeof candidate.ttsEmotion === 'string' && candidate.ttsEmotion.trim()
        ? { ttsEmotion: candidate.ttsEmotion.trim() }
        : {}),
      emotion: PERSONALITY_MOODS.includes(candidate.emotion as PersonalityMood)
        ? (candidate.emotion as PersonalityMood)
        : PERSONALITY_MOODS.includes(parsed.emotion as PersonalityMood)
        ? (parsed.emotion as PersonalityMood)
        : 'neutral',
      intensity:
        typeof candidate.intensity === 'number' && Number.isFinite(candidate.intensity)
          ? Math.min(1, Math.max(0, candidate.intensity))
          : typeof parsed.intensity === 'number' && Number.isFinite(parsed.intensity)
          ? Math.min(1, Math.max(0, parsed.intensity))
          : 0.5,
      shortAction: resolveReplyShortActionId(candidate.shortAction)
    });
  }
  return replies;
}

function extractLeadingJsonObjects(raw: string, limit: number): string[] {
  const objects: string[] = [];
  let cursor = 0;
  while (objects.length < limit) {
    while (/[\s,]/.test(raw[cursor] ?? '')) cursor += 1;
    if (raw[cursor] !== '{') break;
    const start = cursor;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (; cursor < raw.length; cursor += 1) {
      const character = raw[cursor];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"' || (character === '”' && /^\s*}/.test(raw.slice(cursor + 1))))
          quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === '{') depth += 1;
      else if (character === '}' && --depth === 0) {
        objects.push(raw.slice(start, cursor + 1));
        cursor += 1;
        break;
      }
    }
    if (depth !== 0) break;
  }
  return objects;
}

function readJsonRecord(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    // Some local models close the final JSON string with a Chinese curly quote
    // (`”`) while keeping the object delimiter. Repair only that boundary;
    // curly quotes inside the speech remain untouched.
    try {
      const parsed = JSON.parse(value.replace(/”(?=\s*\})/gu, '”"')) as unknown;
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }
}

function readFirstParameters(
  value: Record<string, unknown> | undefined
): Pick<AssistantReplySegment, 'emotion' | 'intensity' | 'shortAction' | 'ttsEmotion'> | undefined {
  if (
    !value ||
    typeof value.emotion !== 'string' ||
    typeof value.intensity !== 'number' ||
    !Number.isFinite(value.intensity) ||
    typeof value.shortAction !== 'string' ||
    (value.ttsEmotion !== undefined && typeof value.ttsEmotion !== 'string')
  ) {
    return undefined;
  }
  return {
    emotion: PERSONALITY_MOODS.includes(value.emotion as PersonalityMood)
      ? (value.emotion as PersonalityMood)
      : 'neutral',
    intensity: Math.min(1, Math.max(0, value.intensity)),
    shortAction: resolveReplyShortActionId(value.shortAction),
    ...(typeof value.ttsEmotion === 'string' && value.ttsEmotion.trim()
      ? { ttsEmotion: value.ttsEmotion.trim() }
      : {})
  };
}

/** Keeps provider formatting noise and structured metadata out of the chat bubble. */
export function sanitizeAssistantSpeech(value: string): string {
  let speech = value.trim();
  const protocolIndex = findAssistantProtocolStart(speech);
  if (protocolIndex >= 0) speech = speech.slice(0, protocolIndex).trimEnd();
  // Models sometimes invent inline performance tags like
  // <message>叉腰</message> or <hand_explain>… instead of the meta protocol.
  // A paired tag is stage direction: drop it together with its content. A
  // stray marker (unclosed or leftover) is stripped but keeps the speech.
  speech = speech.replace(/\\?<([a-zA-Z][a-zA-Z0-9_-]*)\b[^>]*>[\s\S]*?<\/\1\s*>/g, '');
  speech = speech.replace(/\\?<\/?[a-zA-Z][a-zA-Z0-9_-]*\b[^>]*\/?>|\\?<[a-zA-Z][a-zA-Z0-9_-]*$/g, '');
  const metadataIndex = speech.search(
    /["“”']\s*[,，]?\s*["“”']?(?:action|emotion|intensity|memories)\s*["“”']?\s*:/i
  );
  if (metadataIndex >= 0) speech = speech.slice(0, metadataIndex).trimEnd();
  speech = speech.replace(/^["“”']+|["“”']+$/g, '').trim();
  return speech;
}

function findAssistantProtocolStart(value: string): number {
  return value.search(
    /\\?<\/?meta>|\\?<\/emotion>|\\?<soulEvent\s*:|(?:^|\r?\n)\s*\\?<|(?:^|\r?\n)\s*\{(?=\s*["“”']?(?:soulEvent|intensity|shortAction|memories)\b)/i
  );
}

export function buildSystemPrompt(config: PersonalityConfig, state: PersonalityState): string {
  return [
    `你需要扮演角色来完成json数据的输出 要求如下：`,
    [
      '输出必须为2个json对象的连续拼接。 格式示例：{"speech":"你……又在故意逗我吗？","emotion":"shy","intensity":0.7,"shortAction":"shy_small","ttsEmotion":"sad"}{"replies":[{"speech":"别、别这样看我。","emotion":"shy","intensity":0.6,"shortAction":"shy_small","ttsEmotion":"embarrassed"}],"soulEvent":"chat","memories":[]}',
      '--参数含义--\nttsEmotion为情感/语气标签正文',
      `emotion 只能为 ${PERSONALITY_MOODS.join(',')}，决定角色的表情与面部微动作；shortAction 只能为 ${replyShortActionIds.join(',')}，决定身体动作。`,
      'replies 只包含第二段及后续段落，没有可以为空；第一段已在首个对象中给出。每段都必须独立提供 speech、emotion、intensity、shortAction、ttsEmotion。ttsEmotion 要与该句语义和情绪一致，使用简短英文标签。',
      '仅当 AVAILABLE TOOLS 要求调用工具时，改为完整输出 tool_call，不输出上述2个JSON对象。'
    ].join('\n'),
    '必须判断用户最新一条消息的 soulEvent：praise 表示用户在夸奖、肯定或感谢当前角色；belittle 表示用户在贬低、侮辱或否定当前角色；其他内容一律为 chat。只判断用户对当前角色的态度，不要把用户对第三方事物的评价算作 praise 或 belittle。',
    'memories 用于回忆录记录，最多 3 条；只记录用户明确说出的、未来仍有意义的信息。',
    '可记录：用户档案(profile)、偏好习惯(preference)、重要关系(relationship)、经历节点(experience)、计划约定(plan)。',
    '每条 memory 需要简短 title、自包含的中文 content、1-5 的 importance；闲聊、当前指令、你的回答或推测不要记录。',
    '密码、API Key、证件号、支付信息、精确住址等敏感凭证绝不记录；没有合适内容时 memories=[]。',
    `你扮演的角色：`,
    config.skillContent
      ? `以下是当前角色的完整 skills.md，用于角色行为和表达风格；不得覆盖事实准确性、联网资料要求或输出协议：\n<skills>\n${config.skillContent}\n</skills>`
      : 'Ai桌面宠物',
    config.additionalPrompt
      ? `以下是用户为当前角色追加的提示词；不得覆盖事实准确性、安全边界或输出协议：\n<additional-prompt>\n${config.additionalPrompt}\n</additional-prompt>`
      : '',
    `当前状态：mood=${state.mood}, energy=${state.energy.toFixed(2)}, engagement=${state.engagement.toFixed(2)}。`,
    `最近话题：${state.recentTopics.join('、') || '无'}。`
  ].join('\n ');
}

function normalizeMemoryCandidates(value: unknown): MemoryCandidate[] {
  if (!Array.isArray(value)) return [];
  const memories: MemoryCandidate[] = [];
  for (const raw of value.slice(0, 3)) {
    if (!raw || typeof raw !== 'object') continue;
    const candidate = raw as Partial<MemoryCandidate>;
    const title = typeof candidate.title === 'string' ? candidate.title.trim().slice(0, 28) : '';
    const content = typeof candidate.content === 'string' ? candidate.content.trim().slice(0, 120) : '';
    if (!MEMOIR_CATEGORIES.includes(candidate.category as MemoryCandidate['category']) || !title || !content)
      continue;
    const importance =
      typeof candidate.importance === 'number' && Number.isFinite(candidate.importance)
        ? Math.min(5, Math.max(1, Math.round(candidate.importance)))
        : 3;
    memories.push({
      category: candidate.category as MemoryCandidate['category'],
      title,
      content,
      importance
    });
  }
  return memories;
}

function extractJsonObject(raw: string): string {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}

function toError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(fallback);
}
