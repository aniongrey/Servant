import type { VRM } from '@pixiv/three-vrm';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ProceduralHoldMotionAnimator } from './ProceduralHoldMotionAnimator';

describe('ProceduralHoldMotionAnimator', () => {
  it('moves only the body part currently in hold', () => {
    const leftUpperArm = new THREE.Object3D();
    const chest = new THREE.Object3D();
    const nodes: Record<string, THREE.Object3D> = { leftUpperArm, chest };
    const animator = new ProceduralHoldMotionAnimator(createVrm(nodes));

    animator.update(1, ['LeftArm']);

    expect(leftUpperArm.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0);
    expect(chest.quaternion.angleTo(new THREE.Quaternion())).toBe(0);
  });

  it('does not accumulate offsets and fades out after hold ends', () => {
    const leftHand = new THREE.Object3D();
    const animator = new ProceduralHoldMotionAnimator(createVrm({ leftHand }));

    animator.update(0.5, ['LeftArm']);
    animator.beforeMixerUpdate();
    expect(leftHand.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(0.000001);

    for (let frame = 0; frame < 120; frame += 1) {
      animator.update(1 / 60, []);
      animator.beforeMixerUpdate();
    }
    expect(leftHand.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(0.000001);
  });

  it('removes offsets and stays still while globally disabled', () => {
    const leftUpperArm = new THREE.Object3D();
    const animator = new ProceduralHoldMotionAnimator(createVrm({ leftUpperArm }));

    animator.update(0.5, ['LeftArm']);
    expect(leftUpperArm.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0);

    animator.setEnabled(false);
    animator.update(0.5, ['LeftArm']);

    expect(leftUpperArm.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(0.000001);
  });
});

function createVrm(nodes: Record<string, THREE.Object3D>): VRM {
  return {
    humanoid: {
      getNormalizedBoneNode: (name: string) => nodes[name] ?? null
    }
  } as unknown as VRM;
}
