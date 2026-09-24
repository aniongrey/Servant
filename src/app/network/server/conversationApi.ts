import type { IncomingMessage, ServerResponse } from 'node:http';
import { AiSdkClient } from '../../../ai/llm/AiSdkClient';
import type { LlmConfig } from '../../../ai/llm/LlmConfig';
import { validateChatTurnRequest } from '../realtime/ChatTurnContracts';
import type { ChatTurnOrchestrator } from './ChatTurnOrchestrator';
import { fetchMemory } from './memoryServiceClient.ts';
import { memoryGet, memoryPost } from './memoryService';
import { memoryServiceUrl } from './memoryServiceAddress.ts';
import type { ActivityLogRecorder } from '../../logging/ActivityLog';

const CHAT_API = '/api/chat';
const CHAT_HISTORY_API = '/api/chat/history';
const DAILY_MEMORY_API = '/api/chat/daily-memory';

export interface ConversationApiOptions {
  orchestrator: ChatTurnOrchestrator;
  networkFetch: typeof fetch;
  recordEvent?: ActivityLogRecorder;
}

export function conversationApi({ orchestrator, networkFetch, recordEvent }: ConversationApiOptions) {
  const configure = (server: {
    middlewares: {
      use(handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void): void;
    };
  }) => {
    server.middlewares.use((request, response, next) => {
      const route = request.url?.split('?')[0];
      if (route !== CHAT_API && route !== CHAT_HISTORY_API && route !== DAILY_MEMORY_API) return next();
      if (route === CHAT_HISTORY_API) {
        void handleHistoryRequest(request, response);
        return;
      }
      if (route === DAILY_MEMORY_API) {
        void handleDailyMemoryRequest(request, response, networkFetch, recordEvent);
        return;
      }
      void handleChatRequest(request, response, orchestrator);
    });
  };
  return { name: 'conversation-api', configureServer: configure, configurePreviewServer: configure };
}

let dailyMemoryJob: Promise<void> | undefined;

/**
 * The chat endpoint only reports whether the turn was accepted. The reply
 * itself streams to clients over the realtime gateway (chat.text + action.voice).
 */
async function handleChatRequest(
  request: IncomingMessage,
  response: ServerResponse,
  orchestrator: ChatTurnOrchestrator
): Promise<void> {
  if (request.method !== 'POST') return sendJson(response, 405, { error: 'Chat only supports POST' });
  try {
    const payload = validateChatTurnRequest(JSON.parse(await readBody(request)));
    const { turnId } = orchestrator.start(payload);
    sendJson(response, 202, { accepted: true, turnId });
  } catch (error) {
    const status = error instanceof SyntaxError || error instanceof TypeError ? 400 : 500;
    sendJson(response, status, { error: error instanceof Error ? error.message : 'Chat request failed' });
  }
}

async function handleDailyMemoryRequest(
  request: IncomingMessage,
  response: ServerResponse,
  networkFetch: typeof fetch,
  recordEvent?: ActivityLogRecorder
): Promise<void> {
  if (request.method !== 'POST') return sendJson(response, 405, { error: 'Daily memory only supports POST' });
  try {
    const value = JSON.parse(await readBody(request)) as { config?: LlmConfig; timezone?: string };
    if (!value.config || typeof value.timezone !== 'string' || value.timezone.length > 100) {
      throw new TypeError('Invalid daily memory request');
    }
    if (!dailyMemoryJob) {
      recordEvent?.({ channel: 'memory', status: 'start', message: '每日记忆整理开始' });
      dailyMemoryJob = runDailyMemory(value.config, value.timezone, networkFetch)
        .then((result) =>
          recordEvent?.({
            channel: 'memory',
            status: 'success',
            message: result.completed ? `每日记忆整理完成 · ${result.count} 条` : '每日记忆已整理'
          })
        )
        .catch((error) => {
          recordEvent?.({
            channel: 'memory',
            status: 'error',
            message: '每日记忆整理失败',
            details: { error: error instanceof Error ? error.message : String(error) }
          });
          logFailure(error);
        })
        .finally(() => {
          dailyMemoryJob = undefined;
        });
    }
    sendJson(response, 202, { accepted: true });
  } catch (error) {
    sendJson(response, 400, {
      error: error instanceof Error ? error.message : 'Invalid daily memory request'
    });
  }
}

async function runDailyMemory(
  config: LlmConfig,
  timezone: string,
  networkFetch: typeof fetch
): Promise<{ completed: boolean; count: number }> {
  const pending = (await memoryGet(`/daily?timezone=${encodeURIComponent(timezone)}`)) as {
    date: string;
    completed: boolean;
    messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; created_at: string }>;
  };
  if (pending.completed) return { completed: false, count: 0 };
  const llm = new AiSdkClient(config, networkFetch);
  for (let offset = 0; offset < pending.messages.length; offset += 100) {
    const candidates = await llm.extractDailyMemories(
      pending.messages.slice(offset, offset + 100).map((message) => ({
        id: message.id,
        role: message.role,
        text: message.content,
        createdAt: Date.parse(message.created_at)
      }))
    );
    if (candidates.length) {
      await memoryPost('/memories', {
        memories: candidates.map((candidate) => ({
          memory_type: candidate.memoryType,
          summary: candidate.summary,
          people: candidate.people,
          keywords: candidate.keywords,
          event_time_start: candidate.eventTimeStart,
          event_time_end: candidate.eventTimeEnd,
          importance: candidate.importance,
          source_message_ids: candidate.sourceMessageIds,
          source_conversation_id: 'companion'
        }))
      });
    }
  }
  await memoryPost('/daily/complete', { date: pending.date });
  return { completed: true, count: pending.messages.length };
}

async function handleHistoryRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'DELETE') {
    sendJson(response, 405, { error: 'Chat history only supports GET and DELETE' });
    return;
  }
  try {
    const query = request.url?.slice(CHAT_HISTORY_API.length) ?? '';
    // Through the shared client, not a bare fetch: the webview asks for history
    // as soon as it boots, which is exactly when the memory service is still
    // warming up and a raw fetch would answer 503.
    const upstream = await fetchMemory(memoryServiceUrl(`/messages${query}`), {
      method: request.method,
      headers: { 'X-Shiro-Memory': '1' }
    });
    response.statusCode = upstream.status;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    sendJson(response, 503, { error: error instanceof Error ? error.message : 'Chat history unavailable' });
  }
}

async function readBody(request: AsyncIterable<Buffer>): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 1_000_000) throw new TypeError('Chat request is too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(value));
}

function logFailure(error: unknown): void {
  console.warn('[chat] daily memory job failed:', error instanceof Error ? error.message : error);
}
