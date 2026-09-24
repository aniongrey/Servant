import { backendFetch } from './backendFetch.ts';
import type { LlmConfig } from '../../ai/llm/LlmConfig';
import { CHAT_TURN_FEATURE } from './realtime/ChatTurnContracts';
import type { ChatTurnRequest } from './realtime/ChatTurnContracts';
import type { RealtimeGatewayClient } from './realtime/RealtimeGatewayClient';

export type { ChatTurnRequest } from './realtime/ChatTurnContracts';

export interface ChatTurnAccepted {
  accepted: true;
  turnId: string;
}

/**
 * Submits one chat turn. The HTTP response carries no business data — the
 * reply arrives on the `chat.text` stream and spoken segments on `action.voice`.
 */
export async function submitChatTurn(
  request: ChatTurnRequest,
  signal?: AbortSignal
): Promise<ChatTurnAccepted> {
  const response = await backendFetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal
  });
  const body = (await response.json()) as ChatTurnAccepted & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `聊天服务请求失败 (${response.status})`);
  return body;
}

/** Cancels one active turn (or all of this gateway's turns when omitted). */
export function cancelChatTurn(client: RealtimeGatewayClient, turnId?: string): boolean {
  return client.sendCommand(CHAT_TURN_FEATURE, 'cancel', turnId ? { turnId } : undefined);
}

export async function requestDailyMemoryJob(config: LlmConfig, signal?: AbortSignal): Promise<void> {
  const response = await backendFetch('/api/chat/daily-memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    }),
    signal
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: string };
    throw new Error(body.error ?? `每日记忆任务启动失败 (${response.status})`);
  }
}
