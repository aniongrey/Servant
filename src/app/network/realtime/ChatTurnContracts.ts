import type { ChatMessage, PersonalityConfig, PersonalityState } from '../../../ai/llm/types';
import type { LlmConfig } from '../../../ai/llm/LlmConfig';
import type { SpeechSdkTtsLanguage } from '../../../ai/tts/speechSdkTypes';
import type { TtsEmotionMarkup } from '../../../ai/tts/ttsEmotionMarkup';

/**
 * The contract for starting one chat turn. The transport (HTTP /api/chat or a
 * `chat.turn` websocket command) only reports success/failure; the reply
 * itself is broadcast on the chat.text / action.voice streams.
 */
export const CHAT_TURN_FEATURE = 'chat.turn' as const;

/**
 * How many stored messages the server reads back as LLM context, before the
 * current turn is appended. The chat page owns the preference (see
 * `ui/chat/chatContextSettings.ts`) and sends it with every turn, so the
 * contract — not the server — is where the range lives.
 */
export const DEFAULT_CONTEXT_MESSAGE_LIMIT = 8;
export const MIN_CONTEXT_MESSAGE_LIMIT = 2;
export const MAX_CONTEXT_MESSAGE_LIMIT = 50;

/** Clamps any stored or incoming value into the supported range. */
export function normalizeContextMessageLimit(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_CONTEXT_MESSAGE_LIMIT;
  return Math.min(MAX_CONTEXT_MESSAGE_LIMIT, Math.max(MIN_CONTEXT_MESSAGE_LIMIT, Math.round(parsed)));
}

export interface ChatTurnRequest {
  message: ChatMessage;
  llmConfig: LlmConfig;
  personality: PersonalityConfig;
  personalityState: PersonalityState;
  soulContext: string;
  webSearchEnabled: boolean;
  internal?: 'missed-reminder';
  ttsLanguage: SpeechSdkTtsLanguage;
  ttsEmotionMarkup?: TtsEmotionMarkup;
  contextMessageLimit?: number;
}

export interface ChatTurnAccepted {
  accepted: true;
  turnId: string;
}

export function validateChatTurnRequest(value: unknown): ChatTurnRequest {
  if (!value || typeof value !== 'object') throw new TypeError('Chat request must be an object');
  const payload = value as Partial<ChatTurnRequest>;
  if (
    !payload.message ||
    typeof payload.message.id !== 'string' ||
    payload.message.role !== 'user' ||
    typeof payload.message.text !== 'string' ||
    !payload.message.text.trim() ||
    payload.message.text.length > 20_000 ||
    !payload.llmConfig ||
    !payload.personality ||
    !payload.personalityState ||
    typeof payload.soulContext !== 'string' ||
    typeof payload.webSearchEnabled !== 'boolean' ||
    (payload.contextMessageLimit !== undefined && typeof payload.contextMessageLimit !== 'number') ||
    (payload.internal !== undefined && payload.internal !== 'missed-reminder')
  ) {
    throw new TypeError('Invalid chat request');
  }
  // Normalized, never trusted: the client picks the preference, the range is ours.
  return { ...payload, contextMessageLimit: normalizeContextMessageLimit(payload.contextMessageLimit) } as ChatTurnRequest;
}
