import * as THREE from 'three';

interface HeadFeedbackAnimation {
  baseScale: THREE.Vector3;
  frameId: number;
}

const headFeedbackAnimations = new WeakMap<THREE.Object3D, HeadFeedbackAnimation>();

export function cancelHeadFeedback(root: THREE.Object3D): void {
  const animation = headFeedbackAnimations.get(root);
  if (!animation) return;
  cancelAnimationFrame(animation.frameId);
  root.scale.copy(animation.baseScale);
  headFeedbackAnimations.delete(root);
}

export function animateHeadFeedback(
  root: THREE.Object3D,
  pressedScale: [number, number, number],
  durationMs = 210
): void {
  const active = headFeedbackAnimations.get(root);
  if (active) {
    cancelAnimationFrame(active.frameId);
    root.scale.copy(active.baseScale);
  }
  const animation: HeadFeedbackAnimation = {
    baseScale: active?.baseScale ?? root.scale.clone(),
    frameId: 0
  };
  const start = performance.now();
  const frame = (now: number) => {
    const progress = Math.min(1, (now - start) / durationMs);
    const shape = progress < 0.55 ? progress / 0.55 : 1 - (progress - 0.55) / 0.45;
    const amount = Math.sin(shape * Math.PI * 0.5);
    const base = animation.baseScale;
    root.scale.set(
      base.x * (1 + (pressedScale[0] - 1) * amount),
      base.y * (1 + (pressedScale[1] - 1) * amount),
      base.z * (1 + (pressedScale[2] - 1) * amount)
    );
    if (progress < 1) {
      animation.frameId = requestAnimationFrame(frame);
    } else {
      root.scale.copy(base);
      headFeedbackAnimations.delete(root);
    }
  };
  animation.frameId = requestAnimationFrame(frame);
  headFeedbackAnimations.set(root, animation);
}
