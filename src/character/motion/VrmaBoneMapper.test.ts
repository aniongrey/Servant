import * as THREE from 'three';
import { VRMAnimation } from '@pixiv/three-vrm-animation';
import { describe, expect, it } from 'vitest';
import { createVrmAnimationBoneMappingReport, summarizeVrmAnimationBoneMapping } from './VrmaBoneMapper';

describe('VrmaBoneMapper', () => {
  it('reports mapped and missing humanoid tracks', () => {
    const vrmAnimation = new VRMAnimation();
    vrmAnimation.humanoidTracks.translation.set(
      'hips',
      new THREE.VectorKeyframeTrack('hips.position', [0], [0, 1, 0])
    );
    vrmAnimation.humanoidTracks.rotation.set(
      'hips',
      new THREE.QuaternionKeyframeTrack('hips.quaternion', [0], [0, 0, 0, 1])
    );
    vrmAnimation.humanoidTracks.rotation.set(
      'leftUpperArm',
      new THREE.QuaternionKeyframeTrack('leftUpperArm.quaternion', [0], [0, 0, 0, 1])
    );

    const normalizedHips = new THREE.Bone();
    normalizedHips.name = 'NormalizedHips';
    const rawHips = new THREE.Bone();
    rawHips.name = 'RawHips';
    const target = {
      humanoid: {
        getNormalizedBoneNode(name: string) {
          return name === 'hips' ? normalizedHips : null;
        },
        getRawBoneNode(name: string) {
          return name === 'hips' ? rawHips : null;
        }
      }
    };

    const report = createVrmAnimationBoneMappingReport(vrmAnimation, target, 2);
    const summary = summarizeVrmAnimationBoneMapping(report, 'test_motion');

    expect(report.sourceTrackCount).toBe(3);
    expect(report.mappedTrackCount).toBe(2);
    expect(report.missingTrackCount).toBe(1);
    expect(report.entries).toEqual([
      {
        humanBoneName: 'hips',
        trackTypes: ['translation', 'rotation'],
        normalizedNodeName: 'NormalizedHips',
        rawNodeName: 'RawHips'
      },
      {
        humanBoneName: 'leftUpperArm',
        trackTypes: ['rotation'],
        normalizedNodeName: undefined,
        rawNodeName: undefined
      }
    ]);
    expect(summary.level).toBe('warn');
    expect(summary.message).toContain('mapped 2/3 humanoid tracks');
    expect(summary.message).toContain('missing leftUpperArm');
  });
});
