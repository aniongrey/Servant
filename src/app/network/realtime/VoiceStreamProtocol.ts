import { isRecord } from './RealtimeProtocol.ts';
import { PERSONALITY_MOODS, type PersonalityMood } from '../../../ai/llm/types.ts';

/**
 * Events of the `action.voice` stream: everything the desktop character needs
 * to perform reply segments (spoken text plus short actions) and the playback
 * receipts it reports back. The chat text the user reads travels on the
 * separate `chat.text` stream (see ChatStreamProtocol).
 */

export const ACTION_VOICE_TOPIC = 'action.voice' as const;

export interface DesktopReplySegment {
  text: string;
  spokenText: string;
  emotion: PersonalityMood;
  intensity: number;
  shortAction: string;
  /** Optional native VRM expression override, used by expression test tooling. */
  expression?: string;
}

export type VoiceStreamEvent =
  | {
      type: 'reply-stream-start';
      id: string;
      segment: DesktopReplySegment;
      source: 'conversation';
      characterId?: string;
    }
  | {
      type: 'reply-stream-segment';
      id: string;
      index: number;
      segment: DesktopReplySegment;
      source: 'conversation';
      characterId?: string;
    }
  | {
      type: 'reply-stream-end';
      id: string;
      segmentCount: number;
      source: 'conversation';
      characterId?: string;
    }
  | {
      type: 'reply-sequence';
      id: string;
      segments: DesktopReplySegment[];
      source: 'conversation';
      characterId?: string;
    }
  | {
      type: 'speech-start';
      id: string;
      text: string;
      playback?: 'stream' | 'final';
      source?: 'conversation' | 'reminder';
      characterId?: string;
    }
  | { type: 'speech-delta'; id: string; text: string; source: 'conversation'; characterId?: string }
  | {
      type: 'speech-end';
      id: string;
      text?: string;
      spokenText?: string;
      source?: 'conversation' | 'reminder';
      characterId?: string;
    }
  | { type: 'speech-cancel'; id: string; source: 'conversation'; characterId?: string }
  | { type: 'speech-playback-started'; id: string; source: 'conversation'; characterId?: string }
  | { type: 'speech-playback-completed'; id: string; source: 'conversation'; characterId?: string };

/** Server-side validation: throws with a readable message when the payload is not publishable. */
export function validateVoiceStreamEvent(value: unknown): VoiceStreamEvent {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new TypeError('Voice stream event type is required');
  }
  if (value.type === 'reply-stream-start') {
    assertVoiceEnvelope(value);
    return {
      type: 'reply-stream-start',
      id: value.id as string,
      source: 'conversation',
      segment: readReplySegment(value.segment),
      ...readCharacterTarget(value)
    };
  }
  if (value.type === 'reply-stream-segment') {
    assertVoiceEnvelope(value);
    if (!Number.isInteger(value.index) || (value.index as number) < 1) {
      throw new TypeError('invalid reply-stream-segment index');
    }
    return {
      type: 'reply-stream-segment',
      id: value.id as string,
      index: value.index as number,
      source: 'conversation',
      segment: readReplySegment(value.segment),
      ...readCharacterTarget(value)
    };
  }
  if (value.type === 'reply-stream-end') {
    assertVoiceEnvelope(value);
    if (!Number.isInteger(value.segmentCount) || (value.segmentCount as number) < 1) {
      throw new TypeError('invalid reply-stream-end segment count');
    }
    return {
      type: value.type,
      id: value.id as string,
      segmentCount: value.segmentCount as number,
      source: 'conversation',
      ...readCharacterTarget(value)
    };
  }
  if (value.type === 'reply-sequence') {
    if (
      typeof value.id !== 'string' ||
      value.id.length === 0 ||
      value.id.length > 128 ||
      value.source !== 'conversation' ||
      !Array.isArray(value.segments) ||
      value.segments.length === 0
    ) {
      throw new TypeError('invalid reply-sequence event');
    }
    const segments = value.segments.map(readReplySegment);
    assertCharacterTarget(value);
    return {
      type: value.type,
      id: value.id as string,
      segments,
      source: 'conversation',
      ...readCharacterTarget(value)
    };
  }
  if (value.type === 'speech-start') {
    if (
      typeof value.id !== 'string' ||
      value.id.length === 0 ||
      value.id.length > 128 ||
      typeof value.text !== 'string' ||
      value.text.length === 0 ||
      value.text.length > 1000
    ) {
      throw new TypeError('invalid speech-start event');
    }
    if (value.source !== undefined && value.source !== 'conversation' && value.source !== 'reminder') {
      throw new TypeError('invalid speech-start source');
    }
    if (value.playback !== undefined && value.playback !== 'stream' && value.playback !== 'final') {
      throw new TypeError('invalid speech-start playback mode');
    }
    return {
      type: value.type,
      id: value.id,
      text: value.text,
      ...(value.playback ? { playback: value.playback } : {}),
      ...(value.source ? { source: value.source } : {}),
      ...readCharacterTarget(value)
    };
  }
  if (value.type === 'speech-delta') {
    if (
      typeof value.id !== 'string' ||
      value.id.length === 0 ||
      value.id.length > 128 ||
      typeof value.text !== 'string' ||
      value.text.length === 0 ||
      value.text.length > 1000 ||
      value.source !== 'conversation'
    ) {
      throw new TypeError('invalid speech-delta event');
    }
    assertCharacterTarget(value);
    return {
      type: value.type,
      id: value.id,
      text: value.text,
      source: value.source,
      ...readCharacterTarget(value)
    };
  }
  if (value.type === 'speech-end') {
    if (typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 128) {
      throw new TypeError('invalid speech-end event');
    }
    if (
      (value.text !== undefined && (typeof value.text !== 'string' || value.text.length > 1000)) ||
      (value.spokenText !== undefined &&
        (typeof value.spokenText !== 'string' || value.spokenText.length > 2000)) ||
      (value.source !== undefined && value.source !== 'conversation' && value.source !== 'reminder')
    ) {
      throw new TypeError('invalid speech-end event');
    }
    return {
      type: value.type,
      id: value.id,
      ...(typeof value.text === 'string' ? { text: value.text } : {}),
      ...(typeof value.spokenText === 'string' ? { spokenText: value.spokenText } : {}),
      ...(value.source ? { source: value.source } : {}),
      ...readCharacterTarget(value)
    };
  }
  if (
    value.type === 'speech-cancel' ||
    value.type === 'speech-playback-started' ||
    value.type === 'speech-playback-completed'
  ) {
    if (
      typeof value.id !== 'string' ||
      value.id.length === 0 ||
      value.id.length > 128 ||
      value.source !== 'conversation'
    ) {
      throw new TypeError(`invalid ${value.type} event`);
    }
    assertCharacterTarget(value);
    return {
      type: value.type,
      id: value.id,
      source: 'conversation',
      ...readCharacterTarget(value)
    };
  }
  throw new TypeError(`Unknown voice stream event: ${value.type}`);
}

/** Client-side parsing: returns undefined for anything the strict validator rejects. */
export function parseVoiceStreamEvent(value: unknown): VoiceStreamEvent | undefined {
  try {
    return validateVoiceStreamEvent(value);
  } catch {
    return undefined;
  }
}

function assertVoiceEnvelope(value: Record<string, unknown>): void {
  if (
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    value.id.length > 128 ||
    value.source !== 'conversation'
  ) {
    throw new TypeError(`invalid ${String(value.type)} event`);
  }
  assertCharacterTarget(value);
}

function assertCharacterTarget(value: Record<string, unknown>): void {
  if (
    value.characterId !== undefined &&
    (typeof value.characterId !== 'string' ||
      value.characterId.length === 0 ||
      value.characterId.length > 128)
  ) {
    throw new TypeError('invalid voice stream character id');
  }
}

function readCharacterTarget(value: Record<string, unknown>): { characterId?: string } {
  assertCharacterTarget(value);
  return typeof value.characterId === 'string' ? { characterId: value.characterId } : {};
}

function readReplySegment(value: unknown): DesktopReplySegment {
  if (
    !isRecord(value) ||
    typeof value.text !== 'string' ||
    value.text.length === 0 ||
    value.text.length > 1000 ||
    typeof value.spokenText !== 'string' ||
    value.spokenText.length === 0 ||
    value.spokenText.length > 2000 ||
    typeof value.shortAction !== 'string' ||
    value.shortAction.length === 0 ||
    value.shortAction.length > 64 ||
    (value.expression !== undefined &&
      (typeof value.expression !== 'string' ||
        value.expression.length === 0 ||
        value.expression.length > 64)) ||
    !PERSONALITY_MOODS.includes(value.emotion as PersonalityMood) ||
    typeof value.intensity !== 'number' ||
    !Number.isFinite(value.intensity) ||
    value.intensity < 0 ||
    value.intensity > 1
  ) {
    throw new TypeError('invalid reply stream segment');
  }
  return {
    text: value.text,
    spokenText: value.spokenText,
    emotion: value.emotion as PersonalityMood,
    intensity: value.intensity,
    shortAction: value.shortAction,
    ...(typeof value.expression === 'string' ? { expression: value.expression } : {})
  };
}
