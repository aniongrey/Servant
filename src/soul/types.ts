export const SOUL_NEEDS = ['none', 'attention', 'comfort', 'play', 'rest'] as const;
export type SoulNeed = (typeof SOUL_NEEDS)[number];

export const SOUL_EVENT_TYPES = ['praise', 'chat', 'belittle'] as const;
export type SoulEventType = (typeof SOUL_EVENT_TYPES)[number];

export interface SoulEvent {
  id: string;
  type: SoulEventType;
  description: string;
  timestamp: number;
}

export interface SoulState {
  mood: {
    happiness: number;
    anger: number;
    sadness: number;
  };
  relation: {
    intimacy: number;
    trust: number;
  };
  currentNeed: SoulNeed;
  recentEvents: SoulEvent[];
  updatedAt: number;
}

export interface SoulStateStorage {
  load(characterId: string): SoulState | null;
  save(characterId: string, state: SoulState): void;
  clear(characterId: string): void;
}
