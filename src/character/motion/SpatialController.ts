import type { Facing, SpatialPlaybackAdapter, SpatialState } from '../../app/runtimeTypes';
import type { RuntimeStore } from '../../app/state/RuntimeStore';
import { delay, throwIfAborted } from '../../app/utils/delay';

type Point = { x?: number; y?: number; scale?: number };

export class SpatialController {
  constructor(
    private readonly store: RuntimeStore,
    private readonly playbackAdapter?: SpatialPlaybackAdapter
  ) {}

  async moveTo(target: Point, duration: number, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    this.patch({
      ...target,
      offscreen: false,
      tailVisible: false
    });
    await delay(duration, signal);
  }

  async moveBy(delta: Point, duration: number, signal?: AbortSignal): Promise<void> {
    const current = this.store.getSnapshot().spatial;
    await this.moveTo(
      {
        x: delta.x === undefined ? current.x : current.x + delta.x,
        y: delta.y === undefined ? current.y : current.y + delta.y,
        scale: delta.scale === undefined ? current.scale : current.scale + delta.scale
      },
      duration,
      signal
    );
  }

  face(direction: Facing): void {
    this.patch({ facing: direction });
  }

  async hideOffscreen(side: 'left' | 'right', tailVisible = true, signal?: AbortSignal): Promise<void> {
    this.patch({
      x: side === 'left' ? -12 : 112,
      facing: side === 'left' ? 'right' : 'left',
      offscreen: true,
      tailVisible
    });
    await delay(520, signal);
  }

  async returnToHome(signal?: AbortSignal): Promise<void> {
    this.patch({
      x: 50,
      y: 50,
      scale: 1,
      facing: 'user',
      offscreen: false,
      tailVisible: false
    });
    await delay(420, signal);
  }

  private patch(partial: Partial<SpatialState>): void {
    const nextSpatial = {
      ...this.store.getSnapshot().spatial,
      ...partial
    };

    this.store.patch({
      spatial: nextSpatial
    });
    this.playbackAdapter?.applySpatial(nextSpatial);
  }
}
