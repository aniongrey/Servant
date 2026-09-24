import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import * as THREE from 'three';
import { actionBodyPartOrder } from './actions/actionBodyParts';
import type { ActionBodyPart } from '../../app/runtimeTypes';

const MICRO_MOTION_CYCLE_SECONDS = 4.2;
const MICRO_MOTION_FADE_SPEED = 6;
const MIN_VISIBLE_WEIGHT = 0.0001;

export type HoldMotionPart = ActionBodyPart | 'Full';

interface HoldMotionBone {
  part: ActionBodyPart;
  node: THREE.Object3D;
  rotation: THREE.Vector3;
  position: THREE.Vector3;
  phaseOffset: number;
  appliedRotation: THREE.Quaternion;
  appliedPosition: THREE.Vector3;
}

interface HoldMotionBoneDefinition {
  part: ActionBodyPart;
  bone: VRMHumanBoneName;
  rotation?: [number, number, number];
  position?: [number, number, number];
  phaseOffset: number;
}

const boneDefinitions: HoldMotionBoneDefinition[] = [
  { part: 'Root', bone: 'hips', rotation: [0, 0.003, 0], position: [0.001, 0, 0], phaseOffset: 0.2 },
  { part: 'LowerBody', bone: 'leftUpperLeg', rotation: [0.002, 0, 0.002], phaseOffset: 0.4 },
  { part: 'LowerBody', bone: 'rightUpperLeg', rotation: [-0.002, 0, -0.002], phaseOffset: 0.4 },
  { part: 'Torso', bone: 'spine', rotation: [0.0035, 0.002, 0.0015], phaseOffset: 0 },
  { part: 'Head', bone: 'neck', rotation: [0.004, 0.003, 0.0015], phaseOffset: 0.8 },
  { part: 'Head', bone: 'head', rotation: [0.002, 0.0025, 0.001], phaseOffset: 1.1 },
  { part: 'LeftArm', bone: 'leftUpperArm', rotation: [0.003, 0.002, 0.006], phaseOffset: 0.1 },
  { part: 'LeftArm', bone: 'leftLowerArm', rotation: [0.0035, 0.002, 0.002], phaseOffset: 0.65 },
  { part: 'LeftArm', bone: 'leftHand', rotation: [0.002, 0.0015, 0.003], phaseOffset: 1.2 },
  { part: 'RightArm', bone: 'rightUpperArm', rotation: [0.003, -0.002, -0.006], phaseOffset: 0.1 },
  { part: 'RightArm', bone: 'rightLowerArm', rotation: [0.0035, -0.002, -0.002], phaseOffset: 0.65 },
  { part: 'RightArm', bone: 'rightHand', rotation: [0.002, -0.0015, -0.003], phaseOffset: 1.2 },
  { part: 'Face', bone: 'jaw', rotation: [0.001, 0, 0], phaseOffset: 1.6 }
];

export class ProceduralHoldMotionAnimator {
  private readonly bones: HoldMotionBone[];
  private readonly weights = new Map<ActionBodyPart, number>(actionBodyPartOrder.map((part) => [part, 0]));
  private phase = 0;
  private enabled: boolean;

  constructor(vrm: VRM, enabled = true) {
    this.enabled = enabled;
    this.bones = boneDefinitions
      .map((definition) => createHoldMotionBone(vrm, definition))
      .filter((bone): bone is HoldMotionBone => Boolean(bone));
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return;
    }

    this.beforeMixerUpdate();
    this.enabled = enabled;
    if (!enabled) {
      this.phase = 0;
      for (const part of actionBodyPartOrder) {
        this.weights.set(part, 0);
      }
    }
  }

  beforeMixerUpdate(): void {
    for (const bone of this.bones) {
      bone.node.quaternion.multiply(bone.appliedRotation.clone().invert());
      bone.node.position.sub(bone.appliedPosition);
      bone.appliedRotation.identity();
      bone.appliedPosition.set(0, 0, 0);
    }
  }

  update(deltaSeconds: number, activeParts: readonly HoldMotionPart[]): void {
    if (!this.enabled) {
      return;
    }

    const safeDelta = Math.max(0, deltaSeconds);
    const fullBodyActive = activeParts.includes('Full');
    const activePartSet = new Set(activeParts);
    let hasVisibleMotion = false;

    for (const part of actionBodyPartOrder) {
      const target = fullBodyActive || activePartSet.has(part) ? 1 : 0;
      const weight = THREE.MathUtils.damp(
        this.weights.get(part) ?? 0,
        target,
        MICRO_MOTION_FADE_SPEED,
        safeDelta
      );
      this.weights.set(part, weight);
      hasVisibleMotion ||= target > 0 || weight > MIN_VISIBLE_WEIGHT;
    }

    if (hasVisibleMotion) {
      this.phase = (this.phase + safeDelta / MICRO_MOTION_CYCLE_SECONDS) % 1;
    } else {
      this.phase = 0;
    }

    const cycle = this.phase * Math.PI * 2;
    for (const bone of this.bones) {
      const weight = this.weights.get(bone.part) ?? 0;
      const primary = Math.sin(cycle + bone.phaseOffset);
      const secondary = Math.sin(cycle * 2 + bone.phaseOffset * 0.7) * 0.22;
      const motion = (primary + secondary) * weight;
      bone.appliedRotation.setFromEuler(
        new THREE.Euler(bone.rotation.x * motion, bone.rotation.y * motion, bone.rotation.z * motion, 'XYZ')
      );
      bone.appliedPosition.copy(bone.position).multiplyScalar(motion);
      bone.node.quaternion.multiply(bone.appliedRotation);
      bone.node.position.add(bone.appliedPosition);
    }
  }
}

function createHoldMotionBone(vrm: VRM, definition: HoldMotionBoneDefinition): HoldMotionBone | undefined {
  const node = vrm.humanoid.getNormalizedBoneNode(definition.bone);
  if (!node) {
    return undefined;
  }

  return {
    part: definition.part,
    node,
    rotation: new THREE.Vector3(...(definition.rotation ?? [0, 0, 0])),
    position: new THREE.Vector3(...(definition.position ?? [0, 0, 0])),
    phaseOffset: definition.phaseOffset,
    appliedRotation: new THREE.Quaternion(),
    appliedPosition: new THREE.Vector3()
  };
}
