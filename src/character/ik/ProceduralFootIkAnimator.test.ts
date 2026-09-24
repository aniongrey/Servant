import type { VRM } from '@pixiv/three-vrm';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ProceduralFootIkAnimator } from './ProceduralFootIkAnimator';

describe('ProceduralFootIkAnimator', () => {
  it('counteracts slow horizontal drift while a foot remains planted', () => {
    const rig = createLegRig();
    const animator = new ProceduralFootIkAnimator(rig.vrm);

    animator.update(1 / 60);
    const initialX = rig.foot.getWorldPosition(new THREE.Vector3()).x;

    for (let frame = 0; frame < 20; frame += 1) {
      animator.beforeMixerUpdate();
      rig.hips.position.x += 0.001;
      rig.root.updateWorldMatrix(true, true);
      animator.update(1 / 60);
    }

    const lockedX = rig.foot.getWorldPosition(new THREE.Vector3()).x;
    expect(Math.abs(lockedX - initialX)).toBeLessThan(0.01);
    expect(Math.abs(rig.hips.position.x - initialX)).toBeGreaterThan(0.015);
  });

  it('restores procedural offsets immediately when disabled', () => {
    const rig = createLegRig();
    const animator = new ProceduralFootIkAnimator(rig.vrm);

    animator.update(1 / 60);
    animator.beforeMixerUpdate();
    rig.hips.position.x += 0.002;
    rig.root.updateWorldMatrix(true, true);
    animator.update(1 / 60);
    animator.setEnabled(false);

    expect(rig.upperLeg.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(0.000001);
    expect(rig.lowerLeg.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(0.000001);
  });

  it('does not jump on the frame that crosses the contact line', () => {
    const rig = createLegRig();
    const animator = new ProceduralFootIkAnimator(rig.vrm);

    rig.hips.position.y = 0.036;
    rig.root.updateWorldMatrix(true, true);
    animator.update(1 / 60);
    animator.beforeMixerUpdate();

    rig.hips.position.y = 0.034;
    rig.root.updateWorldMatrix(true, true);
    const beforeIk = rig.foot.getWorldPosition(new THREE.Vector3());
    animator.update(1 / 60);
    const afterIk = rig.foot.getWorldPosition(new THREE.Vector3());

    expect(afterIk.distanceTo(beforeIk)).toBeLessThan(0.0001);
  });
});

function createLegRig(): {
  vrm: VRM;
  root: THREE.Group;
  hips: THREE.Object3D;
  upperLeg: THREE.Object3D;
  lowerLeg: THREE.Object3D;
  foot: THREE.Object3D;
} {
  const root = new THREE.Group();
  const hips = new THREE.Object3D();
  const upperLeg = new THREE.Object3D();
  const lowerLeg = new THREE.Object3D();
  const foot = new THREE.Object3D();
  upperLeg.position.set(0.12, -0.2, 0);
  lowerLeg.position.set(0, -0.65, 0.04);
  foot.position.set(0, -0.65, -0.04);
  root.add(hips);
  hips.add(upperLeg);
  upperLeg.add(lowerLeg);
  lowerLeg.add(foot);
  root.updateWorldMatrix(true, true);

  const nodes: Record<string, THREE.Object3D> = {
    hips,
    leftUpperLeg: upperLeg,
    leftLowerLeg: lowerLeg,
    leftFoot: foot
  };
  const vrm = {
    scene: root,
    humanoid: {
      getNormalizedBoneNode: (name: string) => nodes[name] ?? null
    }
  } as unknown as VRM;

  return { vrm, root, hips, upperLeg, lowerLeg, foot };
}
