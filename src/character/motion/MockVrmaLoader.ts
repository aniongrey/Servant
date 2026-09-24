import type { LoadedMotion, MotionLoader, MotionMeta } from '../../app/runtimeTypes';
import { delay } from '../../app/utils/delay';

export class MockVrmaLoader implements MotionLoader {
  public loadCount = 0;

  constructor(private readonly latencyMs = 90) {}

  async load(meta: MotionMeta, signal?: AbortSignal): Promise<LoadedMotion> {
    this.loadCount += 1;
    await delay(this.latencyMs, signal);

    return {
      meta,
      clipName: `mock_clip:${meta.id}`
    };
  }
}
