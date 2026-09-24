import { buildAvailableToolsPrompt, ChatToolRegistry } from '../../../ai/llm/ChatToolRegistry';
import { preprocessConversationInput, type ProcessedConversationInput } from '../../../ai/llm/InputPreprocessor';
import type { ChatMessage, ChatToolDefinition } from '../../../ai/llm/types';
import { getCurrentTime } from '../../../ai/llm/LlmTools';
import type { ChatTurnRequest } from '../realtime/ChatTurnContracts';
import { loadMemoryContextDetails, loadRecentChatHistory, type MemoryEntry } from './memoryService';

const CONTEXT_LOOKUP_TIMEOUT_MS = 2_500;

export interface BuiltChatContext {
  input: ProcessedConversationInput;
  history: ChatMessage[];
  tools: ChatToolDefinition[];
  instruction: string;
  continuationInstruction: string;
  debug: {
    memory: {
      query: string;
      entries: Array<Pick<MemoryEntry, 'summary' | 'importance' | 'score' | 'event_time_start' | 'created_at'>>;
    };
    currentTime?: ReturnType<typeof getCurrentTime>;
  };
}

export class ChatContextBuilder {
  constructor(private readonly tools = new ChatToolRegistry()) {}

  async build(request: ChatTurnRequest, signal: AbortSignal): Promise<BuiltChatContext> {
    const input = preprocessConversationInput(request.message.text);
    if (input.isEmpty || input.isLikelyNoise) throw new Error('没有识别到有效输入。');
    const availableTools = this.tools.listAvailable(input, request.webSearchEnabled);
    const lookups = Promise.all([
      loadRecentChatHistory(signal, request.contextMessageLimit),
      loadMemoryContextDetails(input.text, signal)
    ]);
    // Memory enriches the prompt but must not cancel a slow local embedding
    // request: its warm-up can finish after chat has already continued.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const [storedHistory, memory] = await Promise.race([
      lookups,
      new Promise<readonly [ChatMessage[], { prompt: string; entries: MemoryEntry[] }]>(
        (resolve) => { timeout = setTimeout(() => resolve([[], { prompt: '', entries: [] }]), CONTEXT_LOOKUP_TIMEOUT_MS); }
      )
    ]).finally(() => {
      if (timeout !== undefined) clearTimeout(timeout);
    });
    const history = [
      ...storedHistory.filter((message) => message.id !== request.message.id),
      { ...request.message, text: input.text }
    ];
    const toolPrompt = buildAvailableToolsPrompt(availableTools);
    const time = availableTools.some(({ name }) => name === 'scheduler') ? getCurrentTime() : undefined;
    const continuationInstruction = [
      request.soulContext,
      memory.prompt,
      time
        ? `CURRENT TIME\n本地：${time.localDateTime}\nIANA 时区：${time.timeZone}\nUTC：${time.utcTime}`
        : ''
    ]
      .filter(Boolean)
      .join('\n\n');
    const requiredToolInstruction = input.requiresSchedulerTool
      ? '当前用户消息是明确的提醒/闹钟命令。你必须且只能输出 scheduler 的完整 <tool_call>；禁止回复“稍后叫你”“会提醒你”等口头承诺，也禁止直接输出台词。'
      : input.requiresWebSearchTool && request.webSearchEnabled
        ? '当前用户消息是明确的联网搜索命令。你必须且只能输出 web-search 的完整 <tool_call>；禁止用未经查询的内容直接回答。'
        : '';
    return {
      input,
      history,
      tools: availableTools,
      instruction: [continuationInstruction, requiredToolInstruction, toolPrompt].filter(Boolean).join('\n\n'),
      continuationInstruction,
      debug: {
        memory: {
          query: input.text,
          entries: memory.entries.map(({ summary, importance, score, event_time_start, created_at }) => ({
            summary,
            importance,
            score,
            event_time_start,
            created_at
          }))
        },
        ...(time ? { currentTime: time } : {})
      }
    };
  }
}
