import {
  createVRMAnimationClip,
  createVRMAnimationHumanoidTracks,
  VRMAnimationLoaderPlugin
} from '@pixiv/three-vrm-animation';
import type { VRMAnimation } from '@pixiv/three-vrm-animation';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getActionBodyPartBones } from './actions/actionBodyParts';
import { bakeAvatarFitHandIkClip } from '../ik/AvatarFitClipBaker';
import type { AvatarFitConfig } from '../ik/AvatarFitConfig';
import type { LoadedMotion, MotionLoader, MotionMaskPreset, MotionMeta } from '../../app/runtimeTypes';
import { throwIfAborted } from '../../app/utils/delay';
import { createVrmAnimationBoneMappingReport } from './VrmaBoneMapper';

export interface VrmaLoaderOptions {
  fetcher?: typeof fetch;
  createLoader?: () => GLTFLoader;
  getAvatarFitConfig?: () => AvatarFitConfig;
}

export class VrmaLoader implements MotionLoader {
  constructor(private readonly vrm: VRM, private readonly options: VrmaLoaderOptions = {}) {}

  async load(meta: MotionMeta, signal?: AbortSignal): Promise<LoadedMotion> {
    throwIfAborted(signal);

    const url = resolveUrl(meta.url);
    const loader = this.options.createLoader?.() ?? new GLTFLoader();
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

    const bytes = await this.fetchArrayBuffer(url, signal);
    const gltf = await loader.parseAsync(bytes, basePath(url));
    throwIfAborted(signal);

    const vrmAnimation = findVrmAnimation(gltf);
    normalizeMissingHumanoidTracks(vrmAnimation, this.vrm);
    const humanoidTracks = createVRMAnimationHumanoidTracks(
      vrmAnimation,
      this.vrm.humanoid,
      this.vrm.meta.metaVersion
    );
    const mappedTrackCount = humanoidTracks.rotation.size + humanoidTracks.translation.size;
    const vrmBoneMapping = createVrmAnimationBoneMappingReport(vrmAnimation, this.vrm, mappedTrackCount);
    const sourceClip = createVRMAnimationClip(vrmAnimation, this.vrm);
    const trimmedClip = createTrimmedClip(sourceClip, meta.trimStartSeconds, meta.trimEndSeconds, meta.id);
    const maskedClip = meta.bodyParts || meta.mask
      ? createMaskedClip(trimmedClip, this.vrm, meta.bodyParts ?? [meta.mask!], meta.id) : trimmedClip;
    const clip = this.options.getAvatarFitConfig
      ? bakeAvatarFitHandIkClip(maskedClip, this.vrm, this.options.getAvatarFitConfig(), meta.id)
      : maskedClip;
    clip.name = meta.id;

    return {
      meta,
      clipName: clip.name,
      clip,
      vrmAnimation,
      vrmBoneMapping
    };
  }

  private async fetchArrayBuffer(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
    const fetcher = this.options.fetcher ?? globalThis.fetch;
    if (!fetcher) {
      throw new Error('No fetch implementation is available for VRMA loading.');
    }

    const response = await fetcher(url, { signal });
    if (!response.ok) {
      throw new Error(`Failed to load VRMA: ${response.status} ${response.statusText} ${url}`);
    }

    return response.arrayBuffer();
  }
}

function createMaskedClip(
  source: THREE.AnimationClip,
  vrm: VRM,
  mask: MotionMaskPreset[],
  name: string
): THREE.AnimationClip {
  const allowedNodeNames = new Set<string>();

  for (const bone of mask.flatMap(getActionBodyPartBones)) {
    const node = vrm.humanoid.getNormalizedBoneNode(bone);
    if (node) {
      allowedNodeNames.add(node.name);
    }
  }

  const tracks = source.tracks
    .filter((track) => allowedNodeNames.has(track.name.split('.')[0]))
    .map((track) => track.clone());
  return new THREE.AnimationClip(name, source.duration, tracks);
}

function createTrimmedClip(
  source: THREE.AnimationClip,
  startSeconds = 0,
  endSeconds = source.duration,
  name: string
): THREE.AnimationClip {
  const start = Math.max(0, Math.min(startSeconds, source.duration));
  const end = Math.max(start, Math.min(endSeconds, source.duration));

  if (start === 0 && end === source.duration) {
    return source;
  }

  const tracks = source.tracks.map((track) => trimTrack(track, start, end));
  return new THREE.AnimationClip(name, end - start, tracks);
}

function trimTrack(track: THREE.KeyframeTrack, start: number, end: number): THREE.KeyframeTrack {
  const valueSize = track.getValueSize();
  const times: number[] = [];
  const values: number[] = [];
  const sourceTimes = Array.from(track.times as ArrayLike<number>);
  const sourceValues = Array.from(track.values as ArrayLike<number>);
  const interpolatableTrack = track as THREE.KeyframeTrack & {
    createInterpolant(result: Float32Array): { evaluate(time: number): ArrayLike<number> };
  };

  const pushSample = (time: number, normalizedTime: number): void => {
    const existingIndex = sourceTimes.findIndex((sourceTime) => Math.abs(sourceTime - time) < 0.0001);
    const sample =
      existingIndex === -1
        ? Array.from(interpolatableTrack.createInterpolant(new Float32Array(valueSize)).evaluate(time))
        : sourceValues.slice(existingIndex * valueSize, existingIndex * valueSize + valueSize);

    times.push(normalizedTime);
    values.push(...sample);
  };

  pushSample(start, 0);

  sourceTimes.forEach((time, index) => {
    if (time <= start || time >= end) {
      return;
    }

    times.push(time - start);
    values.push(...sourceValues.slice(index * valueSize, index * valueSize + valueSize));
  });

  pushSample(end, end - start);

  const TrackConstructor = track.constructor as new (
    name: string,
    times: number[],
    values: number[]
  ) => THREE.KeyframeTrack;
  return new TrackConstructor(track.name, times, values);
}

function findVrmAnimation(gltf: GLTF): VRMAnimation {
  const animations = gltf.userData.vrmAnimations as VRMAnimation[] | undefined;
  const firstAnimation = animations?.[0];

  if (!firstAnimation) {
    throw new Error('VRMA file did not contain a VRMC_vrm_animation payload.');
  }

  return firstAnimation;
}

export function normalizeMissingHumanoidTracks(vrmAnimation: VRMAnimation, vrm: Pick<VRM, 'humanoid'>): void {
  reassignMissingBoneTrack(vrmAnimation.humanoidTracks.rotation, vrm, 'upperChest', ['chest', 'spine']);
}

function reassignMissingBoneTrack<T extends THREE.KeyframeTrack>(
  tracks: Map<string, T>,
  vrm: Pick<VRM, 'humanoid'>,
  bone: VRMHumanBoneName,
  fallbacks: VRMHumanBoneName[]
): void {
  const track = tracks.get(bone);
  if (!track || vrm.humanoid.getNormalizedBoneNode(bone)) {
    return;
  }

  const fallback = fallbacks.find((candidate) => vrm.humanoid.getNormalizedBoneNode(candidate));
  if (!fallback) {
    return;
  }

  tracks.delete(bone);
  if (!tracks.has(fallback)) {
    tracks.set(fallback, track);
  }
}

function resolveUrl(url: string): string {
  if (typeof globalThis.location === 'undefined') {
    return url;
  }

  return new URL(url, globalThis.location.href).href;
}

function basePath(url: string): string {
  try {
    return new URL('.', url).href;
  } catch {
    const slashIndex = url.lastIndexOf('/');
    return slashIndex === -1 ? '' : url.slice(0, slashIndex + 1);
  }
}
