import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import type { AvatarFitConfig, AvatarHandIkRule } from './AvatarFitConfig';

const BAKE_FPS = 30;
const HAND_IK_MIN_DISTANCE = 0.006;
const FRONT_PUSH_BLEND_HEIGHT = 0.08;
const HAND_COLLIDER_FALLBACK_DIRECTION = {
  leftHand: new THREE.Vector3(-1, 0, 0),
  rightHand: new THREE.Vector3(1, 0, 0)
};
const HAND_CROSS_FALLBACK_DIRECTION = {
  leftHand: 1,
  rightHand: -1
};

type HandBoneName = 'leftHand' | 'rightHand';
type ArmBoneName = 'leftUpperArm' | 'leftLowerArm' | 'rightUpperArm' | 'rightLowerArm';
type BakedArmBoneName = ArmBoneName | HandBoneName;

interface ArmRig {
  handBoneName: HandBoneName;
  upperArmName: ArmBoneName;
  lowerArmName: ArmBoneName;
  upperArm: THREE.Object3D;
  lowerArm: THREE.Object3D;
  hand: THREE.Object3D;
}

export function bakeAvatarFitHandIkClip(
  sourceClip: THREE.AnimationClip,
  vrm: VRM,
  config: AvatarFitConfig,
  bakedClipName: string
): THREE.AnimationClip {
  const rule = config.handIk;

  if (!rule.enabled || rule.strength <= 0) {
    const clone = sourceClip.clone();
    clone.name = bakedClipName;
    return clone;
  }

  const rigs = [getArmRig(vrm, 'leftHand'), getArmRig(vrm, 'rightHand')]
    .filter((rig): rig is ArmRig => Boolean(rig))
    .filter((rig) => clipContainsRig(sourceClip, rig));
  const armBones = uniqueArmBones(rigs);

  if (rigs.length === 0 || armBones.length === 0) {
    const clone = sourceClip.clone();
    clone.name = bakedClipName;
    return clone;
  }

  const snapshot = capturePose(vrm);
  const mixer = new THREE.AnimationMixer(vrm.scene);
  const action = mixer.clipAction(sourceClip);
  const times = createBakeTimes(sourceClip.duration);
  const bakedValues = new Map<BakedArmBoneName, number[]>();
  const wristRotationOffset = createWristRotationOffset(config);

  for (const boneName of armBones) {
    bakedValues.set(boneName, []);
  }

  action.play();

  for (const time of times) {
    mixer.setTime(time);
    vrm.scene.updateWorldMatrix(true, true);
    for (const rig of rigs) {
      const desiredHandWorldQuaternion = getObjectWorldQuaternion(rig.hand).multiply(wristRotationOffset);
      solveHandIk(vrm, rig, config, rule);
      setObjectWorldQuaternion(rig.hand, desiredHandWorldQuaternion);
    }
    for (const boneName of armBones) {
      const bone = vrm.humanoid.getNormalizedBoneNode(boneName);
      if (!bone) {
        continue;
      }
      bakedValues
        .get(boneName)
        ?.push(bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w);
    }
  }

  mixer.stopAllAction();
  restorePose(snapshot);

  const bakedTrackNames = new Set(
    armBones
      .map((boneName) => vrm.humanoid.getNormalizedBoneNode(boneName)?.name)
      .filter((name): name is string => Boolean(name))
      .map((name) => `${name}.quaternion`)
  );
  const tracks = sourceClip.tracks
    .filter((track) => !bakedTrackNames.has(track.name))
    .map((track) => track.clone());

  for (const boneName of armBones) {
    const bone = vrm.humanoid.getNormalizedBoneNode(boneName);
    const values = bakedValues.get(boneName);

    if (!bone || !values) {
      continue;
    }

    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values));
  }

  return new THREE.AnimationClip(bakedClipName, sourceClip.duration, tracks);
}

function solveHandIk(vrm: VRM, rig: ArmRig, config: AvatarFitConfig, rule: AvatarHandIkRule): void {
  const handPosition = getObjectWorldPosition(rig.hand);
  let target = handPosition.clone();
  let needsIk = false;
  const headCenter = getHeadColliderCenter(vrm, config);
  const headSafeTarget = pushPointOutsideSphere(
    target,
    headCenter,
    config.colliders.head.radius + rule.margin,
    rig.handBoneName
  );
  needsIk ||= headSafeTarget.distanceToSquared(target) > 0.0000001;
  target = headSafeTarget;

  const torsoSafeTarget = pushPointOutsideTorsoFrustum(
    target,
    getTorsoCenterXZ(vrm),
    getModelFrontDirection(vrm),
    config,
    rule,
    rig.handBoneName
  );
  needsIk ||= torsoSafeTarget.distanceToSquared(target) > 0.0000001;
  target = torsoSafeTarget;

  if (!needsIk) {
    return;
  }

  const iterations = Math.max(1, Math.round(rule.iterations));
  for (let index = 0; index < iterations; index += 1) {
    rotateBoneTowardTarget(rig.lowerArm, rig.hand, target, rule.strength);
    rotateBoneTowardTarget(rig.upperArm, rig.hand, target, rule.strength);

    if (getObjectWorldPosition(rig.hand).distanceTo(target) <= HAND_IK_MIN_DISTANCE) {
      return;
    }
  }
}

function rotateBoneTowardTarget(
  bone: THREE.Object3D,
  endEffector: THREE.Object3D,
  target: THREE.Vector3,
  strength: number
): void {
  const bonePosition = getObjectWorldPosition(bone);
  const currentDirection = getObjectWorldPosition(endEffector).sub(bonePosition).normalize();
  const targetDirection = target.clone().sub(bonePosition).normalize();

  if (currentDirection.lengthSq() < 0.0001 || targetDirection.lengthSq() < 0.0001) {
    return;
  }

  const worldCorrection = new THREE.Quaternion().setFromUnitVectors(currentDirection, targetDirection);
  worldCorrection.slerp(new THREE.Quaternion(), 1 - THREE.MathUtils.clamp(strength, 0, 1));
  const parentWorldQuaternion =
    bone.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
  const localCorrection = parentWorldQuaternion
    .clone()
    .invert()
    .multiply(worldCorrection)
    .multiply(parentWorldQuaternion);
  bone.quaternion.premultiply(localCorrection);
  bone.updateWorldMatrix(true, true);
}

function getArmRig(vrm: VRM, handBoneName: HandBoneName): ArmRig | null {
  const upperArmName = handBoneName === 'leftHand' ? 'leftUpperArm' : 'rightUpperArm';
  const lowerArmName = handBoneName === 'leftHand' ? 'leftLowerArm' : 'rightLowerArm';
  const upperArm = vrm.humanoid.getNormalizedBoneNode(upperArmName);
  const lowerArm = vrm.humanoid.getNormalizedBoneNode(lowerArmName);
  const hand = vrm.humanoid.getNormalizedBoneNode(handBoneName);

  if (!upperArm || !lowerArm || !hand) {
    return null;
  }

  return {
    handBoneName,
    upperArmName,
    lowerArmName,
    upperArm,
    lowerArm,
    hand
  };
}

function clipContainsRig(clip: THREE.AnimationClip, rig: ArmRig): boolean {
  const rigNodeNames = new Set([rig.upperArm.name, rig.lowerArm.name, rig.hand.name]);
  return clip.tracks.some((track) => rigNodeNames.has(track.name.split('.')[0]));
}

function uniqueArmBones(rigs: ArmRig[]): BakedArmBoneName[] {
  return [
    ...new Set(
      rigs.flatMap(
        (rig) => [rig.upperArmName, rig.lowerArmName, rig.handBoneName] satisfies BakedArmBoneName[]
      )
    )
  ];
}

function createBakeTimes(duration: number): number[] {
  const frameCount = Math.max(1, Math.ceil(duration * BAKE_FPS));
  const times: number[] = [];

  for (let frame = 0; frame <= frameCount; frame += 1) {
    times.push(Math.min(duration, frame / BAKE_FPS));
  }

  return times;
}

function pushPointOutsideSphere(
  point: THREE.Vector3,
  center: THREE.Vector3,
  radius: number,
  handBoneName: HandBoneName
): THREE.Vector3 {
  const offset = point.clone().sub(center);
  const distance = offset.length();

  if (distance >= radius) {
    return point;
  }

  if (distance < 0.0001) {
    offset.copy(HAND_COLLIDER_FALLBACK_DIRECTION[handBoneName]);
  } else {
    offset.multiplyScalar(1 / distance);
  }

  return center.clone().add(offset.multiplyScalar(radius));
}

function pushPointOutsideTorsoFrustum(
  point: THREE.Vector3,
  centerXZ: THREE.Vector3,
  frontDirection: THREE.Vector2,
  config: AvatarFitConfig,
  rule: AvatarHandIkRule,
  handBoneName: HandBoneName
): THREE.Vector3 {
  const torso = config.colliders.torso;
  const topHeight = Math.max(torso.topHeight, torso.bottomHeight);
  const bottomHeight = Math.min(torso.topHeight, torso.bottomHeight);

  if (point.y < bottomHeight || point.y > topHeight) {
    return point;
  }

  const heightRange = Math.max(0.0001, topHeight - bottomHeight);
  const t = (point.y - bottomHeight) / heightRange;
  const radius = THREE.MathUtils.lerp(torso.bottomRadius, torso.topRadius, t) + rule.margin;
  const offset = new THREE.Vector2(point.x - centerXZ.x, point.z - centerXZ.z);
  const distance = offset.length();

  if (distance >= radius) {
    return point;
  }

  const radialDirection = offset.clone();
  if (distance < 0.0001) {
    radialDirection.set(
      HAND_COLLIDER_FALLBACK_DIRECTION[handBoneName].x,
      HAND_COLLIDER_FALLBACK_DIRECTION[handBoneName].z
    );
  } else {
    radialDirection.multiplyScalar(1 / distance);
  }

  const radialTarget = new THREE.Vector3(
    centerXZ.x + radialDirection.x * radius,
    point.y,
    centerXZ.z + radialDirection.y * radius
  );

  if (rule.torsoPushMode === 'front' || rule.torsoPushMode === 'crossFront') {
    const frontBlend = getFrontPushBlend(point.y, rule.frontPushMinHeight);

    if (frontBlend > 0) {
      const frontTarget = pushPointToTorsoFront(
        point,
        centerXZ,
        frontDirection,
        radius,
        handBoneName,
        rule.torsoPushMode
      );

      if (frontBlend >= 1) {
        return frontTarget;
      }

      return blendTorsoPushTargets(radialTarget, frontTarget, centerXZ, radius, frontBlend);
    }
  }

  return radialTarget;
}

function getFrontPushBlend(height: number, minHeight: number): number {
  return THREE.MathUtils.smoothstep(height, minHeight, minHeight + FRONT_PUSH_BLEND_HEIGHT);
}

function blendTorsoPushTargets(
  radialTarget: THREE.Vector3,
  frontTarget: THREE.Vector3,
  centerXZ: THREE.Vector3,
  radius: number,
  blend: number
): THREE.Vector3 {
  const radialDirection = new THREE.Vector2(
    radialTarget.x - centerXZ.x,
    radialTarget.z - centerXZ.z
  ).normalize();
  const frontDirection = new THREE.Vector2(
    frontTarget.x - centerXZ.x,
    frontTarget.z - centerXZ.z
  ).normalize();
  const direction = radialDirection.lerp(frontDirection, blend);

  if (direction.lengthSq() < 0.0001) {
    return radialTarget.clone().lerp(frontTarget, blend);
  }

  direction.normalize();
  return new THREE.Vector3(
    centerXZ.x + direction.x * radius,
    radialTarget.y,
    centerXZ.z + direction.y * radius
  );
}

function pushPointToTorsoFront(
  point: THREE.Vector3,
  centerXZ: THREE.Vector3,
  frontDirection: THREE.Vector2,
  radius: number,
  handBoneName: HandBoneName,
  mode: AvatarHandIkRule['torsoPushMode']
): THREE.Vector3 {
  const rightDirection = new THREE.Vector2(frontDirection.y, -frontDirection.x).normalize();
  const offset = new THREE.Vector2(point.x - centerXZ.x, point.z - centerXZ.z);
  let lateral = offset.dot(rightDirection);

  if (mode === 'crossFront' && Math.abs(lateral) < radius * 0.28) {
    lateral = HAND_CROSS_FALLBACK_DIRECTION[handBoneName] * radius * 0.36;
  }

  lateral = THREE.MathUtils.clamp(lateral, -radius * 0.86, radius * 0.86);
  const front = Math.sqrt(Math.max(0, radius * radius - lateral * lateral));
  const nextXZ = new THREE.Vector2(centerXZ.x, centerXZ.z)
    .add(rightDirection.multiplyScalar(lateral))
    .add(frontDirection.clone().multiplyScalar(front));

  return new THREE.Vector3(nextXZ.x, point.y, nextXZ.y);
}

function getHeadColliderCenter(vrm: VRM, config: AvatarFitConfig): THREE.Vector3 {
  const head = vrm.humanoid.getNormalizedBoneNode('head');
  const center = head ? getObjectWorldPosition(head) : new THREE.Vector3();
  center.y = config.colliders.head.height;
  return center;
}

function getTorsoCenterXZ(vrm: VRM): THREE.Vector3 {
  const positions = ['upperChest', 'chest', 'spine', 'hips']
    .map((boneName) => getFirstBoneWorldPosition(vrm, [boneName as VRMHumanBoneName]))
    .filter((position): position is THREE.Vector3 => Boolean(position));

  if (positions.length === 0) {
    return new THREE.Vector3();
  }

  return positions
    .reduce((sum, position) => sum.add(position), new THREE.Vector3())
    .multiplyScalar(1 / positions.length);
}

function getModelFrontDirection(vrm: VRM): THREE.Vector2 {
  const direction = vrm.scene.getWorldDirection(new THREE.Vector3());
  direction.y = 0;

  if (direction.lengthSq() < 0.0001) {
    return new THREE.Vector2(0, 1);
  }

  direction.normalize();
  return new THREE.Vector2(direction.x, direction.z).normalize();
}

function getFirstBoneWorldPosition(vrm: VRM, boneNames: VRMHumanBoneName[]): THREE.Vector3 | null {
  for (const boneName of boneNames) {
    const bone = vrm.humanoid.getNormalizedBoneNode(boneName);

    if (bone) {
      return getObjectWorldPosition(bone);
    }
  }

  return null;
}

function getObjectWorldPosition(object: THREE.Object3D): THREE.Vector3 {
  object.updateWorldMatrix(true, false);
  return new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
}

function getObjectWorldQuaternion(object: THREE.Object3D): THREE.Quaternion {
  object.updateWorldMatrix(true, false);
  return object.getWorldQuaternion(new THREE.Quaternion());
}

function setObjectWorldQuaternion(object: THREE.Object3D, worldQuaternion: THREE.Quaternion): void {
  const parentWorldQuaternion =
    object.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
  object.quaternion.copy(parentWorldQuaternion.invert().multiply(worldQuaternion));
  object.updateWorldMatrix(true, true);
}

function createWristRotationOffset(config: AvatarFitConfig): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(config.wristRotationOffset.x),
      THREE.MathUtils.degToRad(config.wristRotationOffset.y),
      THREE.MathUtils.degToRad(config.wristRotationOffset.z),
      'XYZ'
    )
  );
}

function capturePose(vrm: VRM): PoseSnapshot {
  const objects: THREE.Object3D[] = [];
  vrm.scene.traverse((object) => {
    objects.push(object);
  });

  return {
    scene: vrm.scene,
    scenePosition: vrm.scene.position.clone(),
    sceneQuaternion: vrm.scene.quaternion.clone(),
    objects: objects.map((object) => ({
      object,
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone()
    }))
  };
}

interface PoseSnapshot {
  scene: THREE.Object3D;
  scenePosition: THREE.Vector3;
  sceneQuaternion: THREE.Quaternion;
  objects: ObjectPoseSnapshot[];
}

interface ObjectPoseSnapshot {
  object: THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

function restorePose(snapshot: PoseSnapshot): void {
  snapshot.scene.position.copy(snapshot.scenePosition);
  snapshot.scene.quaternion.copy(snapshot.sceneQuaternion);
  snapshot.objects.forEach(({ object, position, quaternion, scale }) => {
    object.position.copy(position);
    object.quaternion.copy(quaternion);
    object.scale.copy(scale);
  });
  snapshot.scene.updateWorldMatrix(true, true);
}
