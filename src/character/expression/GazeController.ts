import type { GazePlaybackAdapter, GazeTarget } from '../../app/runtimeTypes';
import type { RuntimeStore } from '../../app/state/RuntimeStore';
import { delay, throwIfAborted } from '../../app/utils/delay';

export class GazeController {
  constructor(private readonly store: RuntimeStore, private readonly playbackAdapter?: GazePlaybackAdapter) {}

  async look(target: GazeTarget, duration = 0, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    this.store.patch({
      expression: {
        ...this.store.getSnapshot().expression,
        gaze: target
      }
    });
    this.playbackAdapter?.look(target);
    await delay(duration, signal);
  }
}
