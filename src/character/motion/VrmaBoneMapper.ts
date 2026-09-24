import type * as THREE from 'three';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { VRMAnimation } from '@pixiv/three-vrm-animation';
import type {
  VrmAnimationBoneMappingEntry,
  VrmAnimationBoneMappingReport,
  VrmAnimationHumanoidTrackType
} from '../../app/runtimeTypes';

export interface VrmAnimationBoneMappingTarget {
  humanoid: {
    getNormalizedBoneNode(name: VRMHumanBoneName): THREE.Object3D | null;
    getRawBoneNode(name: VRMHumanBoneName): THREE.Object3D | null;
  };
}

export function createVrmAnimationBoneMappingReport(
  vrmAnimation: VRMAnimation,
  target: VrmAnimationBoneMappingTarget,
  mappedTrackCount: number
): VrmAnimationBoneMappingReport {
  const byBone = new Map<string, Set<VrmAnimationHumanoidTrackType>>();

  vrmAnimation.humanoidTracks.rotation.forEach((_, boneName) => {
    appendTrackType(byBone, boneName, 'rotation');
  });

  vrmAnimation.humanoidTracks.translation.forEach((_, boneName) => {
    appendTrackType(byBone, boneName, 'translation');
  });

  const entries = [...byBone.entries()]
    .map(([humanBoneName, trackTypes]): VrmAnimationBoneMappingEntry => {
      const boneName = humanBoneName as VRMHumanBoneName;
      const normalizedNode = target.humanoid.getNormalizedBoneNode(boneName);
      const rawNode = target.humanoid.getRawBoneNode(boneName);

      return {
        humanBoneName,
        trackTypes: [...trackTypes].sort(sortTrackTypes),
        normalizedNodeName: normalizedNode?.name,
        rawNodeName: rawNode?.name
      };
    })
    .sort((a, b) => a.humanBoneName.localeCompare(b.humanBoneName));

  const sourceTrackCount =
    vrmAnimation.humanoidTracks.rotation.size + vrmAnimation.humanoidTracks.translation.size;

  return {
    entries,
    sourceTrackCount,
    mappedTrackCount,
    missingTrackCount: Math.max(0, sourceTrackCount - mappedTrackCount)
  };
}

export function summarizeVrmAnimationBoneMapping(
  report: VrmAnimationBoneMappingReport,
  motionId: string
): {
  level: 'info' | 'warn';
  message: string;
} {
  const missingBones = report.entries
    .filter((entry) => !entry.normalizedNodeName)
    .map((entry) => entry.humanBoneName);
  const missingSuffix =
    missingBones.length > 0
      ? `; missing ${missingBones.slice(0, 6).join(', ')}${missingBones.length > 6 ? '...' : ''}`
      : '';

  return {
    level: report.missingTrackCount > 0 ? 'warn' : 'info',
    message: `VRMA ${motionId}: mapped ${report.mappedTrackCount}/${report.sourceTrackCount} humanoid tracks${missingSuffix}`
  };
}

function appendTrackType(
  byBone: Map<string, Set<VrmAnimationHumanoidTrackType>>,
  boneName: string,
  trackType: VrmAnimationHumanoidTrackType
): void {
  const trackTypes = byBone.get(boneName) ?? new Set<VrmAnimationHumanoidTrackType>();
  trackTypes.add(trackType);
  byBone.set(boneName, trackTypes);
}

function sortTrackTypes(a: VrmAnimationHumanoidTrackType, b: VrmAnimationHumanoidTrackType): number {
  return trackOrder(a) - trackOrder(b);
}

function trackOrder(trackType: VrmAnimationHumanoidTrackType): number {
  return trackType === 'translation' ? 0 : 1;
}
