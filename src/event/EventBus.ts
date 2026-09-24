import type { RuntimeStore } from '../app/state/RuntimeStore';
import type { GameEvent, GameEventAdapter } from './events/game/types';

export type GameEventListener = (event: GameEvent) => void | Promise<void>;

export class EventBus {
  private readonly adapters = new Map<string, GameEventAdapter>();
  private readonly listeners = new Set<GameEventListener>();
  private running = false;

  constructor(private readonly store?: RuntimeStore) {}

  registerAdapter(adapter: GameEventAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Duplicate game event adapter: ${adapter.id}`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  onEvent(listener: GameEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    await Promise.all(
      [...this.adapters.values()].map((adapter) => adapter.start((event) => this.emit(event)))
    );
    this.store?.appendLog(`EventBus started ${this.adapters.size} adapter(s)`);
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;
    await Promise.all([...this.adapters.values()].map((adapter) => adapter.stop()));
    this.store?.appendLog('EventBus stopped');
  }

  emit(event: GameEvent): void {
    this.store?.appendLog(formatGameEventLog(event));

    for (const listener of this.listeners) {
      Promise.resolve(listener(event)).catch((error: unknown) => {
        this.store?.appendLog(error instanceof Error ? error.message : String(error), 'error');
      });
    }
  }
}

function formatGameEventLog(event: GameEvent): string {
  const detail = event.item ?? event.area ?? event.message;
  return detail
    ? `Game event ${event.game}:${event.type} (${detail})`
    : `Game event ${event.game}:${event.type}`;
}
