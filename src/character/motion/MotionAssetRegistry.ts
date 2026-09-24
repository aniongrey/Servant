import type { LoadedMotion, MotionLoader, MotionMeta } from '../../app/runtimeTypes';

export class MotionAssetRegistry {
  private readonly manifest = new Map<string, MotionMeta>();
  private readonly cache = new Map<string, Promise<LoadedMotion>>();

  constructor(motions: MotionMeta[], private readonly loader: MotionLoader) {
    for (const motion of motions) {
      this.manifest.set(motion.id, motion);
    }
  }

  list(): MotionMeta[] {
    return [...this.manifest.values()];
  }

  get(id: string): MotionMeta {
    const motion = this.manifest.get(id);
    if (!motion) {
      throw new Error(`Unknown motion: ${id}`);
    }
    return motion;
  }

  register(meta: MotionMeta): void {
    this.manifest.set(meta.id, meta);
    this.cache.delete(meta.id);
  }

  clearCache(): void {
    this.cache.clear();
  }

  async preload(id: string, signal?: AbortSignal): Promise<LoadedMotion> {
    const motion = this.get(id);
    const cached = this.cache.get(id);
    if (cached) {
      return cached;
    }

    const loading = this.loader.load(motion, signal).catch((error: unknown) => {
      this.cache.delete(id);
      throw error;
    });

    this.cache.set(id, loading);
    return loading;
  }

  loadedIds(): string[] {
    return [...this.cache.keys()].sort();
  }
}
