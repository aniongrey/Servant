import * as THREE from 'three';
import { VRMAnimation } from '@pixiv/three-vrm-animation';
import { describe, expect, it } from 'vitest';
import { normalizeMissingHumanoidTracks } from './VrmaLoader';

describe('VrmaLoader', () => {
  it('folds upperChest rotation into chest when the target avatar has no upperChest bone', () => {
    const vrmAnimation = new VRMAnimation();
    const upperChestTrack = new THREE.QuaternionKeyframeTrack('upperChest.quaternion', [0], [0, 0, 0, 1]);
    vrmAnimation.humanoidTracks.rotation.set('upperChest', upperChestTrack);

    normalizeMissingHumanoidTracks(vrmAnimation, fakeVrmWithBones(['chest']));

    expect(vrmAnimation.humanoidTracks.rotation.has('upperChest')).toBe(false);
    expect(vrmAnimation.humanoidTracks.rotation.get('chest')).toBe(upperChestTrack);
  });

  it('drops duplicate upperChest rotation when chest already drives the torso', () => {
    const vrmAnimation = new VRMAnimation();
    const chestTrack = new THREE.QuaternionKeyframeTrack('chest.quaternion', [0], [0, 0, 0, 1]);
    vrmAnimation.humanoidTracks.rotation.set('chest', chestTrack);
    vrmAnimation.humanoidTracks.rotation.set(
      'upperChest',
      new THREE.QuaternionKeyframeTrack('upperChest.quaternion', [0], [0, 0, 0, 1])
    );

    normalizeMissingHumanoidTracks(vrmAnimation, fakeVrmWithBones(['chest']));

    expect(vrmAnimation.humanoidTracks.rotation.has('upperChest')).toBe(false);
    expect(vrmAnimation.humanoidTracks.rotation.get('chest')).toBe(chestTrack);
  });
});

function fakeVrmWithBones(bones: string[]): Parameters<typeof normalizeMissingHumanoidTracks>[1] {
  const nodes = new Map(bones.map((bone) => [bone, new THREE.Bone()]));
  return {
    humanoid: {
      getNormalizedBoneNode(name: string) {
        return nodes.get(name) ?? null;
      }
    }
  } as Parameters<typeof normalizeMissingHumanoidTracks>[1];
}
