import type { MotionMeta } from '../../../app/runtimeTypes';
import { actionBodyPartBones, actionBodyPartOrder, toConfigId } from '../actions/actionBodyParts';
import type { ActionBodyPart } from '../../../app/runtimeTypes';
import { bundledVrmaClips } from './vrmaAssetFiles';

export interface VrmaMotionTestMaskOption {
  id: string;
  label: string;
  layer: string;
  mask?: ActionBodyPart;
  boneCount?: number;
}

export const vrmaMotionTestMaskOptions: VrmaMotionTestMaskOption[] = [
  {
    id: 'Full',
    label: 'Full Body',
    layer: 'base'
  },
  ...actionBodyPartOrder.map((part) => ({
    id: part,
    label: part,
    layer: part,
    mask: part,
    boneCount: actionBodyPartBones[part].length
  }))
];

const scannedMotions: MotionMeta[] = bundledVrmaClips.map((clip) => ({
  id: `vrma_test_${toMotionId(clip.id)}`,
  url: clip.url,
  loop: 'once' as const,
  defaultFadeIn: 0.12,
  defaultFadeOut: 0.18,
  interruptible: true,
  returnToIdle: false,
  tags: ['vrma-test', 'manual'],
  durationMs: 1200
}));

const maskedScannedMotions: MotionMeta[] = scannedMotions.flatMap((motion) =>
  vrmaMotionTestMaskOptions
    .filter((option) => option.mask)
    .map(
      (option) =>
        ({
          ...motion,
          id: resolveVrmaManualTestMotionId(motion.id, option.id),
          layer: option.layer,
          mask: option.mask,
          tags: [...motion.tags, 'masked-test', `group:${option.id}`]
        } satisfies MotionMeta)
    )
);

export const vrmaManualTestMotions: MotionMeta[] = scannedMotions;
export const vrmaTestMotions: MotionMeta[] = [...vrmaManualTestMotions, ...maskedScannedMotions];

export function resolveVrmaManualTestMotionId(motionId: string, maskId: string): string {
  return maskId === 'Full' ? motionId : `${motionId}__${toMotionId(maskId)}`;
}

function toMotionId(name: string): string {
  return toConfigId(name);
}
