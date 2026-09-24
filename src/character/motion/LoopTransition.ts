import * as THREE from 'three';
import type { MotionLoop } from '../../app/runtimeTypes';

const LOOP_TRANSITION_SECONDS = 0.4;
const LOOP_TRANSITION_FPS = 30;

const loopTransitionClipCache = new WeakMap<THREE.AnimationClip, THREE.AnimationClip>();

export function getLoopTransitionClip(clip: THREE.AnimationClip, loop: MotionLoop): THREE.AnimationClip {
  if (loop !== 'repeat') {
    return clip;
  }

  const cached = loopTransitionClipCache.get(clip);
  if (cached) {
    return cached;
  }

  const transitionClip = appendLoopTransitionClip(clip);
  loopTransitionClipCache.set(clip, transitionClip);
  return transitionClip;
}

function appendLoopTransitionClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const transitionSeconds = Math.min(
    LOOP_TRANSITION_SECONDS,
    Math.max(1 / LOOP_TRANSITION_FPS, clip.duration * 0.5)
  );
  const tracks = clip.tracks.map((track) =>
    appendLoopTransitionTrack(track, clip.duration, transitionSeconds)
  );

  return new THREE.AnimationClip(clip.name, clip.duration + transitionSeconds, tracks);
}

function appendLoopTransitionTrack(
  track: THREE.KeyframeTrack,
  sourceDuration: number,
  transitionSeconds: number
): THREE.KeyframeTrack {
  const sourceTimes = Array.from(track.times as ArrayLike<number>);
  const sourceValues = Array.from(track.values as ArrayLike<number>);

  if (sourceTimes.length < 2) {
    return track.clone();
  }

  const firstSample = sampleTrack(track, 0);
  const lastSample = sampleTrack(track, sourceDuration);
  const transitionFrameCount = Math.max(1, Math.ceil(transitionSeconds * LOOP_TRANSITION_FPS));
  const times = [...sourceTimes];
  const values = [...sourceValues];

  if (Math.abs(times[times.length - 1] - sourceDuration) > 0.0001) {
    times.push(sourceDuration);
    values.push(...lastSample);
  }

  for (let frame = 1; frame <= transitionFrameCount; frame += 1) {
    const alpha = frame / transitionFrameCount;
    times.push(sourceDuration + alpha * transitionSeconds);
    values.push(...interpolateLoopSample(track, lastSample, firstSample, alpha));
  }

  const TrackConstructor = track.constructor as new (
    name: string,
    times: number[],
    values: number[]
  ) => THREE.KeyframeTrack;
  return new TrackConstructor(track.name, times, values);
}

function sampleTrack(track: THREE.KeyframeTrack, time: number): number[] {
  const valueSize = track.getValueSize();
  const existingIndex = Array.from(track.times as ArrayLike<number>).findIndex(
    (sourceTime) => Math.abs(sourceTime - time) < 0.0001
  );

  if (existingIndex !== -1) {
    const values = Array.from(track.values as ArrayLike<number>);
    return values.slice(existingIndex * valueSize, existingIndex * valueSize + valueSize);
  }

  const interpolatableTrack = track as THREE.KeyframeTrack & {
    createInterpolant(result: Float32Array): { evaluate(time: number): ArrayLike<number> };
  };
  return Array.from(interpolatableTrack.createInterpolant(new Float32Array(valueSize)).evaluate(time));
}

function interpolateLoopSample(
  track: THREE.KeyframeTrack,
  fromSample: number[],
  toSample: number[],
  alpha: number
): number[] {
  const easedAlpha = THREE.MathUtils.smoothstep(alpha, 0, 1);

  if (track instanceof THREE.QuaternionKeyframeTrack && fromSample.length === 4 && toSample.length === 4) {
    const from = new THREE.Quaternion(fromSample[0], fromSample[1], fromSample[2], fromSample[3]).normalize();
    const to = new THREE.Quaternion(toSample[0], toSample[1], toSample[2], toSample[3]).normalize();

    if (from.dot(to) < 0) {
      to.set(-to.x, -to.y, -to.z, -to.w);
    }

    const result = from.slerp(to, easedAlpha);
    return [result.x, result.y, result.z, result.w];
  }

  return fromSample.map((value, index) => THREE.MathUtils.lerp(value, toSample[index] ?? value, easedAlpha));
}
