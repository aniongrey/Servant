import { isRecord } from './RealtimeProtocol.ts';
import { PERSONALITY_MOODS, type ChatMessage, type PersonalityMood } from '../../../ai/llm/types.ts';
import type { SoulEventType } from '../../../soul';

/**
 * Events of the `chat.text` stream: the synchronized conversation transcript.
 * The chat turn itself is orchestrated server side; this stream carries the
 * user message and the multi-segment assistant reply to every listening
 * client (chat window, desktop, monitor page) without any HTTP payload.
 */

export const CHAT_TEXT_TOPIC = 'chat.text' as const;

export interface ChatTurnMeta {
  soulEvent: SoulEventType;
  searching: boolean;
}

export type ChatStreamEvent =
  | { type: 'turn-start'; turnId: string; userMessage: ChatMessage }
  | { type: 'turn-phase'; turnId: string; searching: boolean }
  | {
      type: 'turn-segment';
      turnId: string;
      index: number;
      message: ChatMessage;
      emotion: PersonalityMood;
      intensity: number;
      shortAction: string;
    }
  | { type: 'turn-end'; turnId: string; segmentCount: number; meta?: ChatTurnMeta }
  | { type: 'turn-error'; turnId: string; message: string }
  | { type: 'turn-cancelled'; turnId: string };

/** Server-side validation: throws with a readable message when the payload is not publishable. */
export function validateChatStreamEvent(value: unknown): ChatStreamEvent {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new TypeError('Chat stream event type is required');
  }
  const turnId = readTurnId(value);
  if (value.type === 'turn-start') {
    return { type: 'turn-start', turnId, userMessage: readChatMessage(value.userMessage) };
  }
  if (value.type === 'turn-phase') {
    if (typeof value.searching !== 'boolean') throw new TypeError('invalid turn-phase searching flag');
    return { type: 'turn-phase', turnId, searching: value.searching };
  }
  if (value.type === 'turn-segment') {
    if (!Number.isInteger(value.index) || (value.index as number) < 0) {
      throw new TypeError('invalid turn-segment index');
    }
    if (typeof value.shortAction !== 'string' || value.shortAction.length > 64) {
      throw new TypeError('invalid turn-segment shortAction');
    }
    const presentation = readPresentation(value);
    return {
      type: 'turn-segment',
      turnId,
      index: value.index as number,
      message: readChatMessage(value.message),
      ...presentation,
      shortAction: value.shortAction
    };
  }
  if (value.type === 'turn-end') {
    if (!Number.isInteger(value.segmentCount) || (value.segmentCount as number) < 0) {
      throw new TypeError('invalid turn-end segment count');
    }
    return {
      type: 'turn-end',
      turnId,
      segmentCount: value.segmentCount as number,
      ...(value.meta === undefined ? {} : { meta: readTurnMeta(value.meta) })
    };
  }
  if (value.type === 'turn-error') {
    if (typeof value.message !== 'string' || !value.message || value.message.length > 500) {
      throw new TypeError('invalid turn-error message');
    }
    return { type: 'turn-error', turnId, message: value.message };
  }
  if (value.type === 'turn-cancelled') return { type: 'turn-cancelled', turnId };
  throw new TypeError(`Unknown chat stream event: ${value.type}`);
}

/** Client-side parsing: returns undefined for anything the strict validator rejects. */
export function parseChatStreamEvent(value: unknown): ChatStreamEvent | undefined {
  try {
    return validateChatStreamEvent(value);
  } catch {
    return undefined;
  }
}

function readTurnId(value: Record<string, unknown>): string {
  if (typeof value.turnId !== 'string' || value.turnId.length === 0 || value.turnId.length > 128) {
    throw new TypeError('invalid turn id');
  }
  return value.turnId;
}

function readChatMessage(value: unknown): ChatMessage {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    typeof value.role !== 'string' ||
    !['user', 'assistant'].includes(value.role) ||
    typeof value.text !== 'string' ||
    !value.text ||
    value.text.length > 20_000 ||
    typeof value.createdAt !== 'number' ||
    !Number.isFinite(value.createdAt)
  ) {
    throw new TypeError('invalid chat message');
  }
  if (value.kind !== undefined && value.kind !== 'dialogue' && value.kind !== 'web-search') {
    throw new TypeError('invalid chat message kind');
  }
  const sources = value.sources;
  if (sources !== undefined && !isWebSearchSources(sources)) {
    throw new TypeError('invalid chat message sources');
  }
  return {
    id: value.id,
    role: value.role as ChatMessage['role'],
    text: value.text,
    createdAt: value.createdAt,
    ...(value.kind ? { kind: value.kind as ChatMessage['kind'] } : {}),
    ...(sources ? { sources } : {})
  };
}

function isWebSearchSources(value: unknown): value is ChatMessage['sources'] {
  return (
    Array.isArray(value) &&
    value.length <= 8 &&
    value.every(
      (source) =>
        isRecord(source) &&
        typeof source.title === 'string' &&
        typeof source.url === 'string' &&
        typeof source.snippet === 'string'
    )
  );
}

function readTurnMeta(value: unknown): ChatTurnMeta {
  if (
    !isRecord(value) ||
    typeof value.soulEvent !== 'string' ||
    !['praise', 'chat', 'belittle'].includes(value.soulEvent) ||
    typeof value.searching !== 'boolean'
  ) {
    throw new TypeError('invalid turn meta');
  }
  return {
    soulEvent: value.soulEvent as SoulEventType,
    searching: value.searching
  };
}

function readPresentation(
  value: Record<string, unknown>
): Pick<ChatStreamEvent & { type: 'turn-segment' }, 'emotion' | 'intensity'> {
  if (
    !PERSONALITY_MOODS.includes(value.emotion as PersonalityMood) ||
    typeof value.intensity !== 'number' ||
    !Number.isFinite(value.intensity) ||
    value.intensity < 0 ||
    value.intensity > 1
  ) {
    throw new TypeError('invalid turn-segment presentation');
  }
  return { emotion: value.emotion as PersonalityMood, intensity: value.intensity };
}
