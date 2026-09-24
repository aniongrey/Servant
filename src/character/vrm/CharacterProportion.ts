import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';

export interface CharacterProportionConfig {
  chibiEnabled: boolean;
  headScale: number;
  bodyHeight: number;
  bodyWidth: number;
}

// 初始参数：Q 版默认不开；三个系数取自当前使用中的档位。
export const defaultCharacterProportionConfig: CharacterProportionConfig = {
  chibiEnabled: false,
  headScale: 1,
  bodyHeight: 0.6,
  bodyWidth: 1.08
};

export const characterProportionRanges = {
  headScale: { min: 1, max: 1.8, step: 0.01 },
  bodyHeight: { min: 0.6, max: 1, step: 0.01 },
  bodyWidth: { min: 0.8, max: 1.3, step: 0.01 }
} as const;

const verticalBones: VRMHumanBoneName[] = [
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
  'leftShoulder',
  'rightShoulder'
];
const limbBones: VRMHumanBoneName[] = [
  'leftLowerArm',
  'rightLowerArm',
  'leftHand',
  'rightHand',
  'leftLowerLeg',
  'rightLowerLeg',
  'leftFoot',
  'rightFoot',
  'leftToes',
  'rightToes'
];
const widthBones: VRMHumanBoneName[] = [
  'leftShoulder',
  'rightShoulder',
  'leftUpperArm',
  'rightUpperArm',
  'leftUpperLeg',
  'rightUpperLeg'
];

export function normalizeCharacterProportionConfig(value: unknown): CharacterProportionConfig {
  const saved = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    chibiEnabled:
      typeof saved.chibiEnabled === 'boolean'
        ? saved.chibiEnabled
        : defaultCharacterProportionConfig.chibiEnabled,
    headScale: normalizeNumber(saved.headScale, 'headScale'),
    bodyHeight: normalizeNumber(saved.bodyHeight, 'bodyHeight'),
    bodyWidth: normalizeNumber(saved.bodyWidth, 'bodyWidth')
  };
}

export function createCharacterProportionRig(vrm: Pick<VRM, 'humanoid' | 'scene'>) {
  const head = vrm.humanoid?.getRawBoneNode('head') ?? null;
  const baseHeadScale = head?.scale.clone();
  const baseScenePosition = vrm.scene.position.clone();
  const bones = [...new Set([...verticalBones, ...limbBones, ...widthBones])].flatMap((name) => {
    const node = vrm.humanoid?.getRawBoneNode(name);
    return node ? [{ name, node, position: node.position.clone() }] : [];
  });

  const restore = () => {
    vrm.scene.position.copy(baseScenePosition);
    for (const bone of bones) bone.node.position.copy(bone.position);
    if (head && baseHeadScale) head.scale.copy(baseHeadScale);
  };

  const apply = (config: CharacterProportionConfig) => {
    restore();
    if (!config.chibiEnabled) return;
    const groundY = getGroundY(vrm);

    for (const bone of bones) {
      if (limbBones.includes(bone.name)) bone.node.position.multiplyScalar(config.bodyHeight);
      if (verticalBones.includes(bone.name)) bone.node.position.y *= config.bodyHeight;
      if (widthBones.includes(bone.name)) bone.node.position.x *= config.bodyWidth;
    }
    if (head) head.scale.multiplyScalar(config.headScale);
    vrm.scene.updateMatrixWorld(true);
    const nextGroundY = getGroundY(vrm);
    if (groundY !== null && nextGroundY !== null) vrm.scene.position.y += groundY - nextGroundY;
    vrm.scene.updateMatrixWorld(true);
  };

  return { apply, dispose: restore };
}

function getGroundY(vrm: Pick<VRM, 'humanoid' | 'scene'>): number | null {
  vrm.scene.updateMatrixWorld(true);
  const point = new THREE.Vector3();
  const values = (['leftFoot', 'rightFoot', 'leftToes', 'rightToes'] as VRMHumanBoneName[]).flatMap(
    (name) => {
      const node = vrm.humanoid?.getRawBoneNode(name);
      return node ? [node.getWorldPosition(point).y] : [];
    }
  );
  return values.length ? Math.min(...values) : null;
}

function normalizeNumber(value: unknown, key: keyof typeof characterProportionRanges): number {
  const range = characterProportionRanges[key];
  const fallback = defaultCharacterProportionConfig[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(range.max, Math.max(range.min, value))
    : fallback;
}
