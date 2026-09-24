import { normalizeSoulState } from './SoulState';
import type { SoulState, SoulStateStorage } from './types';

export class MemorySoulStorage implements SoulStateStorage {
  private readonly states = new Map<string, SoulState>();
  load(characterId: string): SoulState | null {
    const state = this.states.get(characterId);
    return state ? structuredClone(state) : null;
  }
  save(characterId: string, state: SoulState): void {
    this.states.set(characterId, structuredClone(state));
  }
  clear(characterId: string): void {
    this.states.delete(characterId);
  }
}

export class LocalStorageSoulStorage implements SoulStateStorage {
  constructor(private readonly prefix = 'soul-state') {}
  load(characterId: string): SoulState | null {
    const raw = globalThis.localStorage?.getItem(this.keyFor(characterId));
    if (!raw) return this.loadLegacy(characterId);
    try {
      return normalizeSoulState(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  save(characterId: string, state: SoulState): void {
    globalThis.localStorage?.setItem(this.keyFor(characterId), JSON.stringify(state));
  }
  clear(characterId: string): void {
    globalThis.localStorage?.removeItem(this.keyFor(characterId));
  }
  private keyFor(characterId: string): string {
    return `${this.prefix}:${characterId}`;
  }
  private loadLegacy(characterId: string): SoulState | null {
    const raw = globalThis.localStorage?.getItem(`character-state:${characterId}`);
    if (!raw) return null;
    try {
      const legacy = JSON.parse(raw) as any;
      return normalizeSoulState({
        mood: {
          happiness: legacy?.emotion?.happy,
          anger: legacy?.emotion?.anger,
          sadness: legacy?.emotion?.sad
        },
        relation: {
          intimacy: legacy?.relationship?.affection,
          trust: legacy?.relationship?.trust
        }
      });
    } catch {
      return null;
    }
  }
}
