import { isRecord } from './RealtimeProtocol.ts';
import type { ChatToolCall, ChatToolDefinition } from '../../../ai/llm/types.ts';

/** Read-only diagnostic stream for the chat tool test page. */
export const CHAT_DEBUG_TOPIC = 'chat.debug' as const;

export type ChatDebugEvent =
  | {
      type: 'context';
      turnId: string;
      at: number;
      input: { text: string; toolCandidates: string[]; requiresSchedulerTool: boolean; requiresWebSearchTool: boolean };
      tools: Pick<ChatToolDefinition, 'name'>[];
      memory: {
        query: string;
        entries: Array<{
          summary: string;
          importance?: number;
          score?: number;
          event_time_start: string | null;
          created_at: string;
        }>;
      };
      currentTime?: Record<string, string>;
    }
  | { type: 'tool-call'; turnId: string; at: number; call: ChatToolCall }
  | { type: 'tool-result'; turnId: string; at: number; tool: string; details: unknown }
  | { type: 'error'; turnId: string; at: number; message: string };

export function parseChatDebugEvent(value: unknown): ChatDebugEvent | undefined {
  if (!isRecord(value) || typeof value.type !== 'string' || typeof value.turnId !== 'string' || typeof value.at !== 'number') {
    return undefined;
  }
  if (value.type === 'context' && isRecord(value.input) && Array.isArray(value.tools) && isRecord(value.memory) && Array.isArray(value.memory.entries)) {
    return value as unknown as ChatDebugEvent;
  }
  if (value.type === 'tool-call' && isRecord(value.call)) return value as unknown as ChatDebugEvent;
  if (value.type === 'tool-result' && typeof value.tool === 'string') return value as unknown as ChatDebugEvent;
  if (value.type === 'error' && typeof value.message === 'string') return value as unknown as ChatDebugEvent;
  return undefined;
}
