import { decaySoulState } from './SoulDecay';
import { createSoulEvent } from './SoulEvent';
import { createDefaultSoulState, normalizeSoulState } from './SoulState';
import { describeSoulState } from './SoulPrompt';
import type { SoulEvent, SoulEventType, SoulNeed, SoulState, SoulStateStorage } from './types';

export interface SoulManagerOptions {
  characterId?: string;
  state?: Partial<SoulState>;
  storage?: SoulStateStorage;
  autoSave?: boolean;
  now?: () => number;
}

export class SoulManager {
  private state: SoulState;
  private readonly characterId: string;
  private readonly storage?: SoulStateStorage;
  private readonly autoSave: boolean;
  private readonly now: () => number;

  constructor(options: SoulManagerOptions = {}) {
    this.characterId = options.characterId ?? 'shiro';
    this.storage = options.storage;
    this.autoSave = options.autoSave ?? true;
    this.now = options.now ?? Date.now;
    this.state = normalizeSoulState(options.state ?? createDefaultSoulState(this.now()), this.now());
  }

  load(): void {
    this.state = normalizeSoulState(this.storage?.load(this.characterId) ?? this.state, this.now());
  }

  getState(): SoulState {
    return structuredClone(this.state);
  }

  setState(state: SoulState): void {
    const now = this.now();
    this.state = normalizeSoulState({ ...state, updatedAt: now }, now);
    this.persistIfNeeded();
  }

  applyEvent(event: SoulEvent): void {
    const next = structuredClone(this.state);
    switch (event.type) {
      case 'praise':
        next.mood.happiness += 8;
        next.relation.intimacy += 2;
        next.relation.trust += 1;
        break;
      case 'chat':
        next.relation.intimacy += 0.25;
        next.relation.trust += 0.1;
        break;
      case 'belittle':
        next.mood.happiness -= 6;
        next.mood.anger += 8;
        next.mood.sadness += 3;
        next.relation.intimacy -= 1;
        next.relation.trust -= 2;
        break;
    }
    next.recentEvents.push(event);
    next.updatedAt = event.timestamp;
    this.state = normalizeSoulState(next, event.timestamp);
    this.persistIfNeeded();
  }

  record(type: SoulEventType, description: string, timestamp = this.now()): void {
    this.applyEvent(createSoulEvent(type, description, timestamp));
  }

  decay(elapsedMs: number): void {
    const next = decaySoulState(this.state, elapsedMs, this.now());
    if (JSON.stringify(next.mood) === JSON.stringify(this.state.mood)) return;
    this.state = next;
    this.persistIfNeeded();
  }

  tick(elapsedMs: number): void {
    this.decay(elapsedMs);
  }

  getPromptContext(): string {
    return describeSoulState(this.state);
  }

  buildContext(): string {
    return this.getPromptContext();
  }

  setNeed(need: SoulNeed): void {
    this.setState({ ...this.state, currentNeed: need, updatedAt: this.now() });
  }

  save(): void {
    this.storage?.save(this.characterId, this.getState());
  }

  reset(): void {
    this.state = createDefaultSoulState(this.now());
    this.storage?.clear(this.characterId);
    this.persistIfNeeded();
  }

  resetState(): void {
    this.reset();
  }

  private persistIfNeeded(): void {
    if (this.autoSave) this.save();
  }
}
