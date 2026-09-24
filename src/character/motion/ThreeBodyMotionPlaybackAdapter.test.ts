import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ThreeBodyMotionPlaybackAdapter } from './ThreeBodyMotionPlaybackAdapter';
import type { LoadedMotion, ResolvedPlayMotionOptions } from '../../app/runtimeTypes';

it('retains the outgoing pose while loading and blends without rest-pose flashes or stale fade timers', async () => {
  vi.useFakeTimers();
  try {
    const root = new THREE.Group();
    const arm = new THREE.Bone(); arm.name = 'arm'; root.add(arm);
    const mixer = new THREE.AnimationMixer(root);
    const adapter = new ThreeBodyMotionPlaybackAdapter(mixer);
    const motion = (id: string, angle: number): LoadedMotion => {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle).toArray();
      const clip = new THREE.AnimationClip(id, 5, [new THREE.QuaternionKeyframeTrack('arm.quaternion', [0, 5], [...q, ...q])]);
      return { clip, clipName: id, meta: { id, url: '', loop: 'once', defaultFadeIn: 1, defaultFadeOut: 1, interruptible: true, returnToIdle: false, tags: [], durationMs: 5000 } };
    };
    const options: ResolvedPlayMotionOptions = { layer: 'base', loop: 'once', fadeIn: 1, fadeOut: 1, clampWhenFinished: true, returnToIdle: false };
    const a = motion('listen', -1);
    const b = motion('present', -1.4);
    const controller = new AbortController();
    const first = adapter.playMotion(a, { ...options, signal: controller.signal });
    const aborted = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    adapter.update(1 / 60);
    expect(Math.abs(arm.rotation.z)).toBeCloseTo(1);
    controller.abort();
    await aborted;
    // Simulate delayed loading of the next VRMA.
    adapter.update(0.5);
    expect(Math.abs(arm.rotation.z)).toBeCloseTo(1);
    const nextController = new AbortController();
    const second = adapter.playMotion(b, { ...options, signal: nextController.signal });
    const secondAborted = expect(second).rejects.toMatchObject({ name: 'AbortError' });
    for (let frame = 0; frame < 30; frame++) {
      adapter.update(1 / 60);
      await vi.advanceTimersByTimeAsync(1000 / 60);
      expect(Math.abs(arm.rotation.z)).toBeGreaterThanOrEqual(0.99);
    }
    nextController.abort();
    await secondAborted;
    // Restart A before its old fade-out timer fires.
    const restartController = new AbortController();
    const restarted = adapter.playMotion(a, { ...options, signal: restartController.signal });
    const restartedAborted = expect(restarted).rejects.toMatchObject({ name: 'AbortError' });
    for (let frame = 0; frame < 70; frame++) {
      adapter.update(1 / 60);
      await vi.advanceTimersByTimeAsync(1000 / 60);
    }
    expect(mixer.clipAction(a.clip!).isRunning()).toBe(true);
    expect(Math.abs(arm.rotation.z)).toBeCloseTo(1);
    restartController.abort();
    await restartedAborted;
    await adapter.stop(0);
    adapter.update(0);
    expect(mixer.clipAction(a.clip!).isRunning()).toBe(false);
    expect(Math.abs(arm.rotation.z)).toBeCloseTo(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
