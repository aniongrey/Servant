import * as THREE from 'three';
import { type AvatarFitConfig } from '../ik/AvatarFitConfig';
import { VrmModelLoader } from './VrmModelLoader';

export function isHeadHit(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  vrm: Awaited<ReturnType<VrmModelLoader['load']>>,
  config: AvatarFitConfig
): boolean {
  const rect = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, camera);
  const head = vrm.humanoid.getNormalizedBoneNode('head');
  if (!head) return false;
  vrm.scene.updateWorldMatrix(true, true);
  camera.updateWorldMatrix(true, false);
  vrm.scene.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) {
      object.skeleton.update();
      object.computeBoundingSphere();
      if (object.boundingBox) object.computeBoundingBox();
    }
  });
  const surfaceHit = raycaster
    .intersectObject(vrm.scene, true)
    .find((hit) => isVisibleSurface(hit.object, hit));
  if (!surfaceHit) return false;
  const center = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld);
  const worldScale = new THREE.Vector3();
  head.getWorldScale(worldScale);
  const radius = config.colliders.head.radius * Math.max(worldScale.x, worldScale.y, worldScale.z) * 1.7;
  return surfaceHit.point.distanceTo(center) <= Math.max(0.01, radius);
}

function isVisibleSurface(object: THREE.Object3D, hit: THREE.Intersection): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false;
  }
  const mesh = object as THREE.Mesh;
  const material = Array.isArray(mesh.material) ? mesh.material[hit.face?.materialIndex ?? 0] : mesh.material;
  return material?.visible !== false && (!material?.transparent || material.opacity > 0);
}

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
