import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';

/**
 * 只需要弹簧骨骼里跟「碰撞」有关的那一小块。用结构类型而不是引用 `VRMSpringBoneManager`，
 * 既让 rig 能直接吃整个 VRM，也让测试能塞一个最小的假实现。
 */
interface SpringBoneCollisionSource {
  // shape 只当 object 收：基类 VRMSpringBoneColliderShape 没有 radius，radius 在
  // Sphere / Capsule 子类上，取值时再收窄。
  joints?: Iterable<{
    settings: { hitRadius: number };
    colliderGroups?: Array<{ colliders?: Array<{ shape: object }> }>;
  }>;
}

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

// 左右镜像骨骼：宽度只改它们的横向间距。宽度若也走缩放，会和这些骨骼自身的旋转
// （抬腿、挥手）合成剪切，所以宽度留在 position 上。
const lateralBones: VRMHumanBoneName[] = [
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

export function createCharacterProportionRig(
  vrm: Pick<VRM, 'humanoid' | 'scene'> & {
    springBoneManager?: SpringBoneCollisionSource | null;
  }
) {
  const hips = vrm.humanoid?.getRawBoneNode('hips') ?? null;
  const head = vrm.humanoid?.getRawBoneNode('head') ?? null;
  const baseHipsScale = hips?.scale.clone() ?? null;
  const baseHeadScale = head?.scale.clone() ?? null;
  const baseScenePosition = vrm.scene.position.clone();
  const lateral = lateralBones.flatMap((name) => {
    const node = vrm.humanoid?.getRawBoneNode(name);
    return node ? [{ node, x: node.position.x }] : [];
  });
  // 弹簧骨骼的碰撞尺寸不随骨骼缩放走（原因见 collectSpringCollisionSizes），要单独跟着缩。
  const springCollisionSizes = collectSpringCollisionSizes(vrm.springBoneManager);

  const restore = () => {
    vrm.scene.position.copy(baseScenePosition);
    if (hips && baseHipsScale) hips.scale.copy(baseHipsScale);
    if (head && baseHeadScale) head.scale.copy(baseHeadScale);
    for (const bone of lateral) bone.node.position.x = bone.x;
    for (const size of springCollisionSizes) size.write(size.base);
  };

  /**
   * Q 版必须把「挂在骨架上的所有东西」一起缩小，裙摆、发梢、尾巴这些由弹簧骨骼
   * 驱动的部件每帧都会被物理重写 position 和 rotation —— 只有祖先骨骼的 scale 是
   * 它们会让路的地方。所以整身从 `hips` 起等比缩到 bodyHeight：关节间距、蒙皮网格、
   * 弹簧链的尺寸一起跟着变。头再做反向补偿，让它保持自己的等比（不被压扁）并叠加
   * 用户给的头身比 —— 于是只有身体矮下去，头相对变大。
   */
  const apply = (config: CharacterProportionConfig) => {
    restore();
    if (!config.chibiEnabled || !hips || !baseHipsScale) return;
    const groundY = getGroundY(vrm);

    hips.scale.copy(baseHipsScale).multiplyScalar(config.bodyHeight);
    if (head && baseHeadScale) {
      head.scale.copy(baseHeadScale).multiplyScalar(config.headScale / config.bodyHeight);
    }
    for (const bone of lateral) bone.node.position.x = bone.x * config.bodyWidth;
    for (const size of springCollisionSizes) size.write(size.base * config.bodyHeight);

    // 腿缩短后脚会离地，把整棵场景压回原来的落脚高度。
    vrm.scene.updateMatrixWorld(true);
    const nextGroundY = getGroundY(vrm);
    if (groundY !== null && nextGroundY !== null) vrm.scene.position.y += groundY - nextGroundY;
    vrm.scene.updateMatrixWorld(true);
  };

  return { apply, dispose: restore };
}

interface SpringCollisionSize {
  base: number;
  write(value: number): void;
}

/**
 * three-vrm 算碰撞时是拿 `shape.radius` / `settings.hitRadius` 去减**世界坐标**距离的：
 * 这两个数字按「世界单位」用，不会乘上碰撞体所在骨骼自己的缩放。骨架整体缩小时它们
 * 不跟着缩，裙摆、马尾就会被原来的大碰撞体顶回原尺寸（实测 bodyHeight=0.75 时裙摆
 * 只缩到 0.84 倍高、0.94 倍宽，而不是 0.75 倍）。所以这里按同一个系数一起缩。
 *
 * 注意连 `hitRadius` 一起：它同样是世界单位的固定间隙，不缩的话裙摆与腿之间会多留
 * 一截按缩小后比例算过大的缝。
 */
function collectSpringCollisionSizes(springBones?: SpringBoneCollisionSource | null): SpringCollisionSize[] {
  const sizes: SpringCollisionSize[] = [];
  const seenColliders = new Set<object>();
  for (const joint of springBones?.joints ?? []) {
    const settings = joint.settings;
    sizes.push({ base: settings.hitRadius, write: (value) => (settings.hitRadius = value) });
    // 碰撞取的是 joint.colliderGroups 里的碰撞体（VRMSpringBoneJoint._collision 就是遍历它），
    // 同一个碰撞体会被多个 joint 引用，只缩一次。
    for (const group of joint.colliderGroups ?? []) {
      for (const collider of group.colliders ?? []) {
        if (seenColliders.has(collider)) continue;
        seenColliders.add(collider);
        const shape = collider.shape as { radius?: unknown };
        if (typeof shape.radius !== 'number') continue;
        const radius = shape as { radius: number };
        sizes.push({ base: radius.radius, write: (value) => (radius.radius = value) });
      }
    }
  }
  return sizes;
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
