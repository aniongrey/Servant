import * as THREE from 'three';
import type { AccessoryPlaybackAdapter, AccessoryPreset } from '../../app/runtimeTypes';

export interface CharacterRigConfig {
  tailBones: string[];
  earBones: string[];
}

interface BoneBinding {
  bone: THREE.Object3D;
  restRotation: THREE.Euler;
}

const PRESETS: Record<AccessoryPreset, { amplitude: number; speed: number; earDrop: number }> = {
  tail_idle: { amplitude: 0.08, speed: 1.2, earDrop: 0 },
  tail_slow: { amplitude: 0.16, speed: 1.6, earDrop: 0 },
  tail_fast: { amplitude: 0.32, speed: 4.5, earDrop: 0 },
  tail_angry: { amplitude: 0.18, speed: 8, earDrop: 0.05 },
  tail_shy: { amplitude: 0.1, speed: 2.4, earDrop: 0.16 },
  ear_twitch: { amplitude: 0.05, speed: 7, earDrop: 0 },
  ear_down: { amplitude: 0.04, speed: 1, earDrop: 0.28 }
};

export class ProceduralAccessoryAnimator implements AccessoryPlaybackAdapter {
  private preset: AccessoryPreset = 'tail_idle';
  private time = 0;
  private readonly tailBones: BoneBinding[];
  private readonly earBones: BoneBinding[];

  constructor(root: THREE.Object3D, config: CharacterRigConfig) {
    this.tailBones = config.tailBones.map((name) => bindBone(root, name)).filter(isBoneBinding);
    this.earBones = config.earBones.map((name) => bindBone(root, name)).filter(isBoneBinding);
  }

  usePreset(preset: AccessoryPreset): void {
    this.preset = preset;
  }

  update(deltaSeconds: number): void {
    this.time += deltaSeconds;
    const config = PRESETS[this.preset];

    this.tailBones.forEach(({ bone, restRotation }, index) => {
      const wave = Math.sin(this.time * config.speed + index * 0.7) * config.amplitude * (1 - index * 0.08);
      bone.rotation.copy(restRotation);
      bone.rotation.z += wave;
      bone.rotation.y += wave * 0.35;
    });

    this.earBones.forEach(({ bone, restRotation }, index) => {
      const twitch = Math.sin(this.time * config.speed + index) * config.amplitude * 0.35;
      bone.rotation.copy(restRotation);
      bone.rotation.x += config.earDrop + twitch;
    });
  }
}

function bindBone(root: THREE.Object3D, name: string): BoneBinding | undefined {
  const bone = root.getObjectByName(name);
  if (!bone) {
    return undefined;
  }

  return {
    bone,
    restRotation: bone.rotation.clone()
  };
}

function isBoneBinding(binding: BoneBinding | undefined): binding is BoneBinding {
  return binding !== undefined;
}
