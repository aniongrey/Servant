import { describe, expect, it } from 'vitest';
import {
  SoundSignatureLootDetector,
  poe2DefaultLootSoundRules,
  type LootSoundEvent,
  type LootSoundEventSource
} from './LootDetector';
import type { GameEvent } from '../../event/events/game/types';

describe('SoundSignatureLootDetector', () => {
  it('emits a loot drop when a configured loot filter sound is detected', async () => {
    const source = new ManualLootSoundSource();
    const detector = new SoundSignatureLootDetector(source, poe2DefaultLootSoundRules);
    const events: GameEvent[] = [];

    await detector.start((event) => events.push(event));
    source.emit({ id: 'divine.wav', confidence: 0.94 });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'LOOT_DROP',
      game: 'poe2',
      source: 'loot_sound',
      item: 'Divine Orb',
      rarity: 90,
      priority: 90
    });
  });
});

class ManualLootSoundSource implements LootSoundEventSource {
  private onSound?: (sound: LootSoundEvent) => void;

  start(onSound: (sound: LootSoundEvent) => void): void {
    this.onSound = onSound;
  }

  stop(): void {
    this.onSound = undefined;
  }

  emit(sound: LootSoundEvent): void {
    this.onSound?.(sound);
  }
}
