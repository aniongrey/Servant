import type { ActionBodyPart } from '../../../app/runtimeTypes';

export type BodyPart = ActionBodyPart;
export type LoopMode = 'none' | 'repeat' | 'pingpong' | 'blend';

export interface VrmaLoopConfig {
  mode: LoopMode;
  blendFrames?: number;
}

export interface VrmaSegment {
  start: number;
  end: number;
  description: string;
  parts: BodyPart[];
  loop?: VrmaLoopConfig;
}

export type VrmaSegmentConfig = Record<string, VrmaSegment[]>;

export const vrmaSegmentBodyParts: readonly BodyPart[] = [
  'Root',
  'LowerBody',
  'Torso',
  'Head',
  'LeftArm',
  'RightArm',
  'Face'
];

export const allVrmaSegmentBodyParts = [...vrmaSegmentBodyParts];

export const vrmaSegmentQuickParts: Record<string, BodyPart[]> = {
  头: ['Head', 'Face'],
  身: ['Root', 'Torso'],
  脚: ['Root', 'LowerBody'],
  手: ['LeftArm', 'RightArm']
};
