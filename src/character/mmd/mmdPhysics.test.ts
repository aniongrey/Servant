import { describe, expect, it } from 'vitest';
import { createMmdPhysicsBackend, EMPTY_MMD_ANIMATION } from './mmdPhysics';

describe('MMD physics backend', () => {
  it('reports the reason physics stays off instead of failing the model load', async () => {
    const failures: unknown[] = [];
    const backend = await createMmdPhysicsBackend({
      loadModule: async () => { throw new Error('wasm blocked by the asset protocol'); },
      onUnavailable: (error) => failures.push(error)
    });
    expect(backend).toBeUndefined();
    expect(failures).toHaveLength(1);
    expect((failures[0] as Error).message).toBe('wasm blocked by the asset protocol');
  });

  it('keeps a binding animation that carries no tracks, so it cannot drive the pose', () => {
    // `MmdRuntime.setAnimation` 只验形状（boneTracks / morphTracks 在不在）。这个空动画的
    // 唯一职责是把 mesh 交给 runtime —— 一旦它带上轨道，就会盖掉 VRMA 驱动的姿态。
    expect(EMPTY_MMD_ANIMATION.boneTracks).toEqual({});
    expect(EMPTY_MMD_ANIMATION.morphTracks).toEqual({});
    expect(EMPTY_MMD_ANIMATION.cameraFrames).toEqual([]);
    expect(EMPTY_MMD_ANIMATION.propertyFrames).toEqual([]);
  });
});
