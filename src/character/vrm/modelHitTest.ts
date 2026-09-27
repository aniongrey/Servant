import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import type { AvatarFitConfig } from '../ik/AvatarFitConfig';

/** 点到了角色的哪个部位；`null` = 没点到。 */
export type CharacterHitPart = 'head' | 'body';
/** 命中判定的结果：部位或「没点到」。 */
export type ModelHitTest = (clientX: number, clientY: number) => CharacterHitPart | null;

/** 头部命中半径：头骨半径放宽到头发的轮廓。 */
export function headColliderRadius(config: AvatarFitConfig): number {
  return config.colliders.head.radius * 1.7;
}

// Bone capsules deliberately approximate the silhouette; no skinned vertices are read.
const bodySegments: [VRMHumanBoneName, VRMHumanBoneName, number][] = [
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

/**
 * 命中半径一律是世界单位（`config.height` 就是角色**应当在**世界里占据的高度，
 * {@link AvatarFitGuide} 画的参考线用的也是它），而骨骼的世界缩放只回答「这个角色
 * 现在被画得比参考高度小多少」：Q 版把整身从 `hips` 缩下去以后，命中体积必须跟着缩，
 * 否则点到角色旁边的空白也算命中。
 *
 * 但缩放不全是「被画小了」。PMX / PMD 这类不以米为单位的格式，适配器会把整个模型
 * 等比换算到米制（见 `MmdCharacter`）——那一次缩放属于**单位换算**，先除掉它才是
 * 真正的比例。这一步不能省：差这一步，命中胶囊就细成几毫米，而桌宠窗口只在
 * 命中判定说「鼠标在角色身上」时才接收指针事件（`useDesktopWindow` 每 32ms 问一次），
 * 于是滚轮缩放和拖窗口都只在一小块区域里生效。VRM 本来就是米，读不到单位缩放就是 1。
 */
function modelUnitScale(scene: THREE.Object3D): number {
  const scale: unknown = scene.userData.modelUnitScale;
  return typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/**
 * 一次骨骼胶囊遍历回答两个问题：「点到角色了吗」「点到的是不是头」。
 *
 * 判定刻意不碰蒙皮顶点：`SkinnedMesh.computeBoundingBox()` 与 `SkinnedMesh.raycast()`
 * 都会逐顶点做骨骼变换，50MB 级的高模上单次点击就是数百万次矩阵混合（秒级卡顿），
 * 而点击是高频交互。胶囊近似轮廓对这两个问题足够，代价与面数无关。
 */
export function createVrmHitTest(
  vrm: VRM,
  camera: THREE.Camera,
  canvas: Pick<HTMLCanvasElement, 'getBoundingClientRect'>,
  getConfig: () => AvatarFitConfig
): ModelHitTest {
  const head = vrm.humanoid.getRawBoneNode('head');
  const unitScale = modelUnitScale(vrm.scene);
  /** 米制半径 → 这个角色当前实际画出来的世界尺寸。 */
  const toWorldRadius = (metres: number, boneScale: THREE.Vector3) =>
    (metres * maxAxis(boneScale)) / unitScale;
  const capsules = bodySegments.flatMap(([from, to, radius]) => {
    const start = vrm.humanoid.getRawBoneNode(from);
    const end = vrm.humanoid.getRawBoneNode(to);
    return start && end ? [{ start, end, radius, part: from }] : [];
  });
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const point = new THREE.Vector3();
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
      return null;
    for (let node: THREE.Object3D | null = vrm.scene; node; node = node.parent) {
      if (!node.visible) return null;
    }
    camera.updateWorldMatrix(true, false);
    pointer.set(((x - rect.left) / rect.width) * 2 - 1, 1 - ((y - rect.top) / rect.height) * 2);
    raycaster.setFromCamera(pointer, camera);
    const config = getConfig();

    if (head) {
      head.getWorldPosition(point);
      head.getWorldScale(scale);
      const radius = toWorldRadius(headColliderRadius(config), scale);
      if (radius > 0 && raycaster.ray.distanceSqToPoint(point) <= radius * radius) return 'head';
    }

    for (const capsule of capsules) {
      const radius =
        capsule.part === 'hips'
          ? Math.max(config.colliders.torso.topRadius, config.colliders.torso.bottomRadius)
          : config.height * capsule.radius;
      if (radius <= 0) continue;
      capsule.start.getWorldPosition(start);
      capsule.end.getWorldPosition(end);
      capsule.end.getWorldScale(scale);
      const scaled = toWorldRadius(radius, scale);
      if (raycaster.ray.distanceSqToSegment(start, end) <= scaled * scaled) return 'body';
    }
    return null;
  };
}

/**
 * 通用 Object3D 的命中判定（真几何射线）。它按几何数据求交，代价随面数增长 ——
 * 蒙皮模型上一旦面数上去就会卡，VRM 角色请走 {@link createVrmHitTest}。
 */
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
      return null;
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
    const hit = raycaster.intersectObject(model, true).some((intersection) => {
      for (let object: THREE.Object3D | null = intersection.object; object; object = object.parent) {
        if (!object.visible) return false;
      }
      const mesh = intersection.object as THREE.Mesh;
      const material = Array.isArray(mesh.material)
        ? mesh.material[intersection.face?.materialIndex ?? 0]
        : mesh.material;
      return material?.visible !== false && (!material?.transparent || material.opacity > 0);
    });
    return hit ? 'body' : null;
  };
}

function maxAxis(scale: THREE.Vector3): number {
  return Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
}
