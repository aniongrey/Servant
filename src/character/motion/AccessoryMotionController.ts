import type { AccessoryPlaybackAdapter, AccessoryPreset } from '../../app/runtimeTypes';
import type { RuntimeStore } from '../../app/state/RuntimeStore';
import { delay, throwIfAborted } from '../../app/utils/delay';

export class AccessoryMotionController {
  constructor(
    private readonly store: RuntimeStore,
    private readonly playbackAdapter?: AccessoryPlaybackAdapter
  ) {}

  async usePreset(preset: AccessoryPreset, transition = 0, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    this.store.patch({
      accessory: {
        preset
      }
    });
    this.playbackAdapter?.usePreset(preset);
    await delay(transition, signal);
  }

  update(deltaSeconds: number): void {
    this.playbackAdapter?.update?.(deltaSeconds);
  }
}
