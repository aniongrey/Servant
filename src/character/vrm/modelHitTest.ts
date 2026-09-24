import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import type { AvatarFitConfig } from '../ik/AvatarFitConfig';

export type ModelHitTest = (clientX: number, clientY: number) => boolean;

// Bone capsules deliberately approximate the silhouette; no skinned vertices are read.
export function createVrmHitTest(
  vrm: VRM,
  camera: THREE.Camera,
  canvas: Pick<HTMLCanvasElement, 'getBoundingClientRect'>,
  getConfig: () => AvatarFitConfig
): ModelHitTest {
  const segments: [VRMHumanBoneName, VRMHumanBoneName, number][] = [
    ['head', 'head', 0],
    ['hips', 'neck', 1],
    ['leftUpperArm', 'leftLowerArm', 0.035],
    ['leftLowerArm', 'leftHand', 0.035],
    ['rightUpperArm', 'rightLowerArm', 0.035],
    ['rightLowerArm', 'rightHand', 0.035],
    ['leftUpperLeg', 'leftLowerLeg', 0.05],
    ['leftLowerLeg', 'leftFoot', 0.04],
    ['rightUpperLeg', 'rightLowerLeg', 0.05],
    ['rightLowerLeg', 'rightFoot', 0.04]
  ];
  const capsules = segments.flatMap(([from, to, radius]) => {
    const start = vrm.humanoid.getRawBoneNode(from);
    const end = vrm.humanoid.getRawBoneNode(to);
    return start && end ? [{ start, end, radius, part: from }] : [];
  });
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();
  const scale = new THREE.Vector3();
  return (x, y) => {
    const rect = canvas.getBoundingClientRect();
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      x < rect.left ||
      x >= rect.right ||
      y < rect.top ||
      y >= rect.bottom
    )
      return false;
    for (let node: THREE.Object3D | null = vrm.scene; node; node = node.parent) {
      if (!node.visible) return false;
    }
    camera.updateWorldMatrix(true, false);
    pointer.set(((x - rect.left) / rect.width) * 2 - 1, 1 - ((y - rect.top) / rect.height) * 2);
    raycaster.setFromCamera(pointer, camera);
    const config = getConfig();
    vrm.scene.getWorldScale(scale);
    const worldScale = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
    return capsules.some((capsule) => {
      capsule.start.getWorldPosition(start);
      capsule.end.getWorldPosition(end);
      const radius =
        capsule.part === 'head'
          ? config.colliders.head.radius * 1.7
          : capsule.part === 'hips'
          ? Math.max(config.colliders.torso.topRadius, config.colliders.torso.bottomRadius)
          : config.height * capsule.radius;
      return radius > 0 && raycaster.ray.distanceSqToSegment(start, end) <= (radius * worldScale) ** 2;
    });
  };
}

export function createModelHitTest(
  model: THREE.Object3D,
  camera: THREE.Camera,
  canvas: Pick<HTMLCanvasElement, 'getBoundingClientRect'>
): ModelHitTest {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  return (x, y) => {
    const rect = canvas.getBoundingClientRect();
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      x < rect.left ||
      y < rect.top ||
      x >= rect.right ||
      y >= rect.bottom
    )
      return false;
    model.updateWorldMatrix(true, true);
    camera.updateWorldMatrix(true, false);
    // Skinned mesh bounds must follow the current pose, rather than the bind pose.
    model.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) {
        object.skeleton.update();
        object.computeBoundingSphere();
        if (object.boundingBox) object.computeBoundingBox();
      }
    });
    pointer.set(((x - rect.left) / rect.width) * 2 - 1, 1 - ((y - rect.top) / rect.height) * 2);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObject(model, true).some((hit) => {
      for (let object: THREE.Object3D | null = hit.object; object; object = object.parent) {
        if (!object.visible) return false;
      }
      const mesh = hit.object as THREE.Mesh;
      const material = Array.isArray(mesh.material)
        ? mesh.material[hit.face?.materialIndex ?? 0]
        : mesh.material;
      return material?.visible !== false && (!material?.transparent || material.opacity > 0);
    });
  };
}
