import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { ActionBodyPart } from '../../../app/runtimeTypes';

export const actionBodyPartOrder = [
  'Root',
  'LowerBody',
  'Torso',
  'Head',
  'LeftArm',
  'RightArm',
  'Face'
] as const satisfies readonly ActionBodyPart[];

export const actionBodyPartBones = {
  Root: ['hips'],

  LowerBody: [
    'leftUpperLeg',
    'leftLowerLeg',
    'leftFoot',
    'leftToes',
    'rightUpperLeg',
    'rightLowerLeg',
    'rightFoot',
    'rightToes'
  ],

  Torso: ['spine', 'chest', 'upperChest'],

  Head: ['neck', 'head'],

  LeftArm: [
    'leftShoulder',
    'leftUpperArm',
    'leftLowerArm',
    'leftHand',
    'leftThumbMetacarpal',
    'leftThumbProximal',
    'leftThumbDistal',
    'leftIndexProximal',
    'leftIndexIntermediate',
    'leftIndexDistal',
    'leftMiddleProximal',
    'leftMiddleIntermediate',
    'leftMiddleDistal',
    'leftRingProximal',
    'leftRingIntermediate',
    'leftRingDistal',
    'leftLittleProximal',
    'leftLittleIntermediate',
    'leftLittleDistal'
  ],

  RightArm: [
    'rightShoulder',
    'rightUpperArm',
    'rightLowerArm',
    'rightHand',
    'rightThumbMetacarpal',
    'rightThumbProximal',
    'rightThumbDistal',
    'rightIndexProximal',
    'rightIndexIntermediate',
    'rightIndexDistal',
    'rightMiddleProximal',
    'rightMiddleIntermediate',
    'rightMiddleDistal',
    'rightRingProximal',
    'rightRingIntermediate',
    'rightRingDistal',
    'rightLittleProximal',
    'rightLittleIntermediate',
    'rightLittleDistal'
  ],

  Face: ['leftEye', 'rightEye', 'jaw']
} satisfies Record<ActionBodyPart, VRMHumanBoneName[]>;

export function getActionBodyPartBones(part: string): VRMHumanBoneName[] {
  return actionBodyPartBones[part as ActionBodyPart] ?? [];
}

export function toConfigId(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}
