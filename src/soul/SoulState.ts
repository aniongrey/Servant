import { SOUL_EVENT_TYPES, SOUL_NEEDS, type SoulEvent, type SoulState } from './types';

export const DEFAULT_SOUL_STATE: SoulState = {
  mood: { happiness: 10, anger: 0, sadness: 0 },
  relation: { intimacy: 20, trust: 30 },
  currentNeed: 'none',
  recentEvents: [],
  updatedAt: 0
};

export function createDefaultSoulState(now = Date.now()): SoulState {
  return { ...structuredClone(DEFAULT_SOUL_STATE), updatedAt: now };
}

export function normalizeSoulState(value: unknown, now = Date.now()): SoulState {
  const source = isRecord(value) ? value : {};
  const mood = isRecord(source.mood) ? source.mood : {};
  const relation = isRecord(source.relation) ? source.relation : {};
  const need = SOUL_NEEDS.includes(source.currentNeed as never) ? source.currentNeed : 'none';
  const recentEvents = Array.isArray(source.recentEvents)
    ? source.recentEvents
        .map(normalizeEvent)
        .filter((event): event is SoulEvent => Boolean(event))
        .slice(-10)
    : [];
  return {
    mood: {
      happiness: readNumber(mood.happiness, 10, -100, 100),
      anger: readNumber(mood.anger, 0, 0, 100),
      sadness: readNumber(mood.sadness, 0, 0, 100)
    },
    relation: {
      intimacy: readNumber(relation.intimacy, 20, 0, 100),
      trust: readNumber(relation.trust, 30, 0, 100)
    },
    currentNeed: need as SoulState['currentNeed'],
    recentEvents,
    updatedAt: readTimestamp(source.updatedAt, now)
  };
}

function normalizeEvent(value: unknown): SoulEvent | null {
  if (!isRecord(value) || !SOUL_EVENT_TYPES.includes(value.type as never)) return null;
  if (typeof value.description !== 'string' || !value.description.trim()) return null;
  return {
    id: typeof value.id === 'string' && value.id ? value.id : createSoulEventId(),
    type: value.type as SoulEvent['type'],
    description: value.description.trim().slice(0, 240),
    timestamp: readTimestamp(value.timestamp, Date.now())
  };
}

export function createSoulEventId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `soul-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Number(value.toFixed(3))))
    : fallback;
}

function readTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
