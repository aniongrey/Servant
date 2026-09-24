import type { RuntimeStore } from '../../app/state/RuntimeStore';

export class FxController {
  constructor(private readonly store: RuntimeStore) {}

  start(id: string, args?: unknown): void {
    const current = this.store.getSnapshot().fx.active;
    this.store.patch({
      fx: {
        active: {
          ...current,
          [id]: args ?? true
        }
      }
    });
  }

  stop(id: string): void {
    const { [id]: _removed, ...remaining } = this.store.getSnapshot().fx.active;
    this.store.patch({
      fx: {
        active: remaining
      }
    });
  }

  stopAll(): void {
    this.store.patch({
      fx: {
        active: {}
      }
    });
  }
}
