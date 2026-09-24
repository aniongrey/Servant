import type { GameEvent, GameEventAdapter } from '../../event/events/game/types';

export interface LootSoundEvent {
  id: string;
  at?: number;
  confidence?: number;
}

export interface LootSoundEventSource {
  start(onSound: (sound: LootSoundEvent) => void): void | Promise<void>;
  stop(): void | Promise<void>;
}

export interface LootSoundRule {
  soundId: string;
  item: string;
  tier: string;
  rarity: number;
  priority: number;
}

export class SoundSignatureLootDetector implements GameEventAdapter {
  readonly id = 'poe2-loot-sound-detector';
  readonly game = 'poe2';
  private emit?: (event: GameEvent) => void;

  constructor(private readonly source: LootSoundEventSource, private readonly rules: LootSoundRule[]) {}

  async start(emit: (event: GameEvent) => void): Promise<void> {
    this.emit = emit;
    await this.source.start((sound) => this.handleSound(sound));
  }

  async stop(): Promise<void> {
    this.emit = undefined;
    await this.source.stop();
  }

  private handleSound(sound: LootSoundEvent): void {
    const rule = this.rules.find((candidate) => candidate.soundId === sound.id);
    if (!rule) {
      return;
    }

    this.emit?.({
      type: 'LOOT_DROP',
      game: 'poe2',
      timestamp: sound.at ?? Date.now(),
      source: 'loot_sound',
      item: rule.item,
      tier: rule.tier,
      rarity: rule.rarity,
      priority: rule.priority,
      metadata: {
        soundId: sound.id,
        confidence: sound.confidence
      }
    });
  }
}

export const poe2DefaultLootSoundRules: LootSoundRule[] = [
  {
    soundId: 'divine.wav',
    item: 'Divine Orb',
    tier: 'legendary',
    rarity: 90,
    priority: 90
  },
  {
    soundId: 'mirror.wav',
    item: 'Mirror of Kalandra',
    tier: 'mythic',
    rarity: 100,
    priority: 100
  }
];
