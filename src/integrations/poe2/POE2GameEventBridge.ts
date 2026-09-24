import type { GameEvent, GameEventAdapter } from '../../event/events/game/types';
import { ClientLogWatcher, type TextFileTailReader } from './ClientLogWatcher';
import {
  SoundSignatureLootDetector,
  type LootSoundEventSource,
  poe2DefaultLootSoundRules
} from './LootDetector';

export interface POE2GameEventBridgeOptions {
  clientLogReader?: TextFileTailReader;
  lootSoundSource?: LootSoundEventSource;
}

export class POE2GameEventBridge implements GameEventAdapter {
  readonly id = 'poe2';
  readonly game = 'poe2';
  private readonly adapters: GameEventAdapter[];

  constructor(options: POE2GameEventBridgeOptions = {}) {
    this.adapters = [
      ...(options.clientLogReader ? [new ClientLogWatcherAdapter(options.clientLogReader)] : []),
      ...(options.lootSoundSource
        ? [new SoundSignatureLootDetector(options.lootSoundSource, poe2DefaultLootSoundRules)]
        : [])
    ];
  }

  async start(emit: (event: GameEvent) => void): Promise<void> {
    await Promise.all(this.adapters.map((adapter) => adapter.start(emit)));
  }

  async stop(): Promise<void> {
    await Promise.all(this.adapters.map((adapter) => adapter.stop()));
  }
}

class ClientLogWatcherAdapter implements GameEventAdapter {
  readonly id = 'poe2-client-log';
  readonly game = 'poe2';
  private readonly watcher: ClientLogWatcher;

  constructor(reader: TextFileTailReader) {
    this.watcher = new ClientLogWatcher(reader);
  }

  start(emit: (event: GameEvent) => void): Promise<void> {
    return this.watcher.start(emit);
  }

  stop(): void {
    this.watcher.stop();
  }
}
