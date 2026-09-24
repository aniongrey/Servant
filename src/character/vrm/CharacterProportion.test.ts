import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createCharacterProportionRig,
  defaultCharacterProportionConfig,
  normalizeCharacterProportionConfig
} from './CharacterProportion';

describe('CharacterProportion', () => {
  it('shortens joint distances without flattening the model root', () => {
    const scene = new THREE.Group();
    const bones = {
      head: bone(0, 0.2, 0),
      leftUpperLeg: bone(0.2, -0.1, 0),
      leftLowerLeg: bone(0, -0.5, 0),
      leftFoot: bone(0, -0.2, 0),
      leftShoulder: bone(0.3, 0.2, 0)
    };
    scene.add(...Object.values(bones));
    const rig = createCharacterProportionRig({
      scene,
      humanoid: { getRawBoneNode: (name: keyof typeof bones) => bones[name] ?? null }
    } as never);

    rig.apply({ chibiEnabled: true, headScale: 1.4, bodyHeight: 0.7, bodyWidth: 1.1 });

    expect(scene.scale.toArray()).toEqual([1, 1, 1]);
    expect(bones.head.scale.toArray()).toEqual([1.4, 1.4, 1.4]);
    expect(bones.head.position.y).toBeCloseTo(0.14);
    expect(bones.leftUpperLeg.position.x).toBeCloseTo(0.22);
    expect(bones.leftUpperLeg.position.y).toBe(-0.1);
    expect(bones.leftLowerLeg.position.y).toBeCloseTo(-0.35);
    expect(bones.leftShoulder.position.x).toBeCloseTo(0.33);
    expect(bones.leftShoulder.position.y).toBeCloseTo(0.14);
    expect(scene.position.y).toBeCloseTo(-0.06);

    rig.apply({ chibiEnabled: false, headScale: 1.4, bodyHeight: 0.7, bodyWidth: 1.1 });
    expect(bones.head.scale.toArray()).toEqual([1, 1, 1]);
    expect(bones.leftLowerLeg.position.y).toBe(-0.5);
    expect(scene.position.y).toBe(0);
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
