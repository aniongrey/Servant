import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createCharacterProportionRig,
  defaultCharacterProportionConfig,
  normalizeCharacterProportionConfig
} from './CharacterProportion';

describe('CharacterProportion', () => {
  function setup() {
    const scene = new THREE.Group();
    const hips = bone(0, 0.9, 0);
    const head = bone(0, 0.4, 0);
    hips.add(head);
    const leftUpperLeg = bone(0.1, 0, 0);
    const leftLowerLeg = bone(0, -0.4, 0);
    const leftFoot = bone(0, -0.4, 0);
    leftUpperLeg.add(leftLowerLeg);
    leftLowerLeg.add(leftFoot);
    hips.add(leftUpperLeg);
    // 弹簧骨骼（裙摆、发梢）：物理每帧重写它的 position/rotation，只有祖先的 scale
    // 是它能跟着 Q 版一起缩的地方。
    const skirt = bone(0, -0.1, 0);
    hips.add(skirt);
    scene.add(hips);
    const bones: Record<string, THREE.Bone> = {
      hips,
      head,
      leftUpperLeg,
      leftLowerLeg,
      leftFoot
    };
    // 弹簧骨骼的碰撞尺寸（世界单位）：真实模型上不跟着骨骼缩，Q 版裙摆就会被顶回原尺寸。
    const springJoint = {
      settings: { hitRadius: 0.02 },
      colliderGroups: [{ colliders: [{ shape: { radius: 0.05 } }, { shape: {} }] }]
    };
    const springCollider = springJoint.colliderGroups[0].colliders[0].shape as { radius: number };
    const rig = createCharacterProportionRig({
      scene,
      humanoid: { getRawBoneNode: (name: string) => bones[name] ?? null },
      springBoneManager: { joints: new Set([springJoint]) }
    } as never);
    return {
      scene,
      hips,
      head,
      leftUpperLeg,
      leftLowerLeg,
      leftFoot,
      skirt,
      springJoint,
      springCollider,
      rig
    };
  }

  it('shrinks the whole body from the hips so spring-driven parts come along', () => {
    const { scene, hips, head, leftUpperLeg, leftLowerLeg, skirt, rig } = setup();

    rig.apply({ chibiEnabled: true, headScale: 1.4, bodyHeight: 0.6, bodyWidth: 1.1 });

    // 缩放落在 hips 上：模型根不动（摸头反馈动画要独占 vrm.scene 的 scale）。
    expect(scene.scale.toArray()).toEqual([1, 1, 1]);
    expect(hips.scale.toArray()).toEqual([0.6, 0.6, 0.6]);
    // 头反向补偿后自己仍是等比，并且叠上了头身比。
    expect(head.scale.x).toBeCloseTo(1.4 / 0.6);
    expect(head.scale.y).toBeCloseTo(1.4 / 0.6);
    expect(head.scale.z).toBeCloseTo(1.4 / 0.6);
    // 头的骨骼位置归骨骼层级管，比例不再改写它。
    expect(head.position.y).toBe(0.4);
    // 宽度仍走左右骨骼间距。
    expect(leftUpperLeg.position.x).toBeCloseTo(0.11);
    expect(leftLowerLeg.position.y).toBe(-0.4);
    // 脚离地后整棵场景压回原来的落脚高度。
    expect(scene.position.y).toBeCloseTo(0.1 - (0.9 - 0.4 * 0.6 * 2));

    scene.updateMatrixWorld(true);
    const skirtScale = skirt.getWorldScale(new THREE.Vector3());
    expect(skirtScale.x).toBeCloseTo(0.6);
    expect(skirtScale.y).toBeCloseTo(0.6);
    const skirtY = skirt.getWorldPosition(new THREE.Vector3()).y;
    expect(skirtY).toBeCloseTo(0.9 - 0.1 * 0.6 + scene.position.y);

    rig.apply({ chibiEnabled: false, headScale: 1.4, bodyHeight: 0.6, bodyWidth: 1.1 });
    expect(hips.scale.toArray()).toEqual([1, 1, 1]);
    expect(head.scale.toArray()).toEqual([1, 1, 1]);
    expect(leftUpperLeg.position.x).toBe(0.1);
    expect(scene.position.y).toBe(0);
  });

  it('scales spring collision sizes so skirts follow the shrunken body', () => {
    const { springJoint, springCollider, rig } = setup();

    rig.apply({ chibiEnabled: true, headScale: 1.4, bodyHeight: 0.6, bodyWidth: 1.1 });

    expect(springJoint.settings.hitRadius).toBeCloseTo(0.02 * 0.6);
    expect(springCollider.radius).toBeCloseTo(0.05 * 0.6);

    rig.apply({ chibiEnabled: false, headScale: 1.4, bodyHeight: 0.6, bodyWidth: 1.1 });

    expect(springJoint.settings.hitRadius).toBe(0.02);
    expect(springCollider.radius).toBe(0.05);
  });

  it('clamps imported settings and fills missing values', () => {
    expect(normalizeCharacterProportionConfig({ headScale: 9, bodyHeight: 0.2 })).toEqual({
      ...defaultCharacterProportionConfig,
      headScale: 1.8,
      bodyHeight: 0.6
    });
  });
});

function bone(x: number, y: number, z: number): THREE.Bone {
  const value = new THREE.Bone();
  value.position.set(x, y, z);
  return value;
}
