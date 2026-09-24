import type { VRM } from '@pixiv/three-vrm';
import * as THREE from 'three';

const CONTACT_HEIGHT = 0.035;
const RELEASE_HEIGHT = 0.075;
const CONTACT_SPEED = 0.09;
const RELEASE_SPEED = 0.2;
const LOCK_FADE_SPEED = 12;
const MAX_FOOT_CORRECTION = 0.14;
const MAX_PELVIS_DROP = 0.065;
const IK_ITERATIONS = 3;
const IK_ITERATION_STRENGTH = 0.65;
const MIN_WEIGHT = 0.001;

interface FootRig {
  upperLeg: THREE.Object3D;
  lowerLeg: THREE.Object3D;
  foot: THREE.Object3D;
  previousPosition: THREE.Vector3 | null;
  lockPosition: THREE.Vector3;
  lockRotation: THREE.Quaternion;
  locked: boolean;
  weight: number;
}

interface SavedPose {
  node: THREE.Object3D;
  quaternion: THREE.Quaternion;
}

export interface ProceduralFootIkAnimatorOptions {
  enabled?: boolean;
  getGroundOffset?: () => number;
}

/** Locks planted feet after motion blending so in-place VRMA clips do not visibly skate. */
export class ProceduralFootIkAnimator {
  private readonly root: THREE.Object3D;
  private readonly hips?: THREE.Object3D;
  private readonly feet: FootRig[];
  private readonly getGroundOffset: () => number;
  private readonly baseGroundHeight: number;
  private enabled: boolean;
  private savedPose: SavedPose[] = [];
  private savedHipsPosition: THREE.Vector3 | null = null;

  constructor(vrm: VRM, options: ProceduralFootIkAnimatorOptions = {}) {
    this.root = vrm.scene;
    this.hips = vrm.humanoid.getNormalizedBoneNode('hips') ?? undefined;
    this.getGroundOffset = options.getGroundOffset ?? (() => 0);
    this.enabled = options.enabled ?? true;
    this.feet = [
      createFootRig(vrm, 'leftUpperLeg', 'leftLowerLeg', 'leftFoot'),
      createFootRig(vrm, 'rightUpperLeg', 'rightLowerLeg', 'rightFoot')
    ].filter((rig): rig is FootRig => Boolean(rig));

    this.root.updateWorldMatrix(true, true);
    const initialHeights = this.feet.map((rig) => this.getRootLocalPosition(rig.foot).y);
    this.baseGroundHeight = initialHeights.length > 0 ? Math.min(...initialHeights) : 0;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return;
    }

    this.restoreAppliedPose();
    this.enabled = enabled;
    if (!enabled) {
      this.resetLocks();
    }
  }

  beforeMixerUpdate(): void {
    this.restoreAppliedPose();
  }

  update(deltaSeconds: number): void {
    if (!this.enabled || this.feet.length === 0) {
      return;
    }

    const safeDelta = Math.max(1 / 240, Math.min(0.1, deltaSeconds));
    const groundHeight = this.baseGroundHeight + this.getGroundOffset();
    this.root.updateWorldMatrix(true, true);

    for (const rig of this.feet) {
      this.updateLockState(rig, safeDelta, groundHeight);
    }

    this.capturePose();
    this.applyPelvisCompensation(groundHeight);

    for (const rig of this.feet) {
      if (rig.weight <= MIN_WEIGHT) {
        continue;
      }
      this.solveFoot(rig);
    }
  }

  private updateLockState(rig: FootRig, deltaSeconds: number, groundHeight: number): void {
    const position = this.getRootLocalPosition(rig.foot);
    const speed = rig.previousPosition
      ? horizontalDistance(position, rig.previousPosition) / deltaSeconds
      : 0;
    const height = position.y - groundHeight;
    const shouldLock = rig.locked
      ? height <= RELEASE_HEIGHT && speed <= RELEASE_SPEED
      : height <= CONTACT_HEIGHT && speed <= CONTACT_SPEED;
    const contactBlend = 1 - THREE.MathUtils.smoothstep(height, 0, CONTACT_HEIGHT);

    if (shouldLock && !rig.locked) {
      rig.locked = true;
      rig.lockPosition.copy(position);
      rig.lockPosition.y = groundHeight;
      rig.lockRotation.copy(this.getRootLocalQuaternion(rig.foot));
    } else if (!shouldLock) {
      rig.locked = false;
    }

    // Keep the prospective target aligned while the foot is around the boundary.
    // This avoids pulling it back to a stale lock point when it crosses the line again.
    if (rig.locked && contactBlend <= MIN_WEIGHT) {
      rig.lockPosition.copy(position);
      rig.lockPosition.y = groundHeight;
      rig.lockRotation.copy(this.getRootLocalQuaternion(rig.foot));
    }

    rig.weight = THREE.MathUtils.damp(
      rig.weight,
      rig.locked ? contactBlend : 0,
      LOCK_FADE_SPEED,
      deltaSeconds
    );
    if (!rig.locked && rig.weight <= MIN_WEIGHT) {
      rig.weight = 0;
    }
    rig.previousPosition = position;
  }

  private capturePose(): void {
    const nodes = new Set<THREE.Object3D>();
    for (const rig of this.feet) {
      if (rig.weight > MIN_WEIGHT) {
        nodes.add(rig.upperLeg);
        nodes.add(rig.lowerLeg);
        nodes.add(rig.foot);
      }
    }
    this.savedPose = [...nodes].map((node) => ({ node, quaternion: node.quaternion.clone() }));
    this.savedHipsPosition = this.hips ? this.hips.position.clone() : null;
  }

  private applyPelvisCompensation(groundHeight: number): void {
    if (!this.hips) {
      return;
    }

    let drop = 0;
    for (const rig of this.feet) {
      if (rig.weight <= MIN_WEIGHT) {
        continue;
      }
      const animatedHeight = this.getRootLocalPosition(rig.foot).y - groundHeight;
      drop = Math.max(drop, Math.max(0, animatedHeight) * rig.weight);
    }
    this.hips.position.y -= Math.min(MAX_PELVIS_DROP, drop);
    this.root.updateWorldMatrix(true, true);
  }

  private solveFoot(rig: FootRig): void {
    const currentWorld = getWorldPosition(rig.foot);
    const targetWorld = this.root.localToWorld(rig.lockPosition.clone());
    const correction = targetWorld.sub(currentWorld);
    if (correction.length() > MAX_FOOT_CORRECTION) {
      correction.setLength(MAX_FOOT_CORRECTION);
    }
    const weightedTarget = currentWorld.clone().addScaledVector(correction, rig.weight);

    for (let iteration = 0; iteration < IK_ITERATIONS; iteration += 1) {
      rotateJointToward(rig.lowerLeg, rig.foot, weightedTarget, IK_ITERATION_STRENGTH);
      rotateJointToward(rig.upperLeg, rig.foot, weightedTarget, IK_ITERATION_STRENGTH);
    }

    const rootWorldRotation = this.root.getWorldQuaternion(new THREE.Quaternion());
    const targetWorldRotation = rootWorldRotation.multiply(rig.lockRotation);
    setWorldQuaternion(rig.foot, targetWorldRotation, rig.weight);
    this.root.updateWorldMatrix(true, true);
  }

  private restoreAppliedPose(): void {
    if (this.savedHipsPosition && this.hips) {
      this.hips.position.copy(this.savedHipsPosition);
    }
    for (const saved of this.savedPose) {
      saved.node.quaternion.copy(saved.quaternion);
    }
    this.savedPose = [];
    this.savedHipsPosition = null;
  }

  private resetLocks(): void {
    for (const rig of this.feet) {
      rig.previousPosition = null;
      rig.locked = false;
      rig.weight = 0;
    }
  }

  private getRootLocalPosition(node: THREE.Object3D): THREE.Vector3 {
    return this.root.worldToLocal(getWorldPosition(node));
  }

  private getRootLocalQuaternion(node: THREE.Object3D): THREE.Quaternion {
    const rootWorld = this.root.getWorldQuaternion(new THREE.Quaternion()).invert();
    return rootWorld.multiply(node.getWorldQuaternion(new THREE.Quaternion()));
  }
}

function createFootRig(
  vrm: VRM,
  upperLegName: 'leftUpperLeg' | 'rightUpperLeg',
  lowerLegName: 'leftLowerLeg' | 'rightLowerLeg',
  footName: 'leftFoot' | 'rightFoot'
): FootRig | undefined {
  const upperLeg = vrm.humanoid.getNormalizedBoneNode(upperLegName);
  const lowerLeg = vrm.humanoid.getNormalizedBoneNode(lowerLegName);
  const foot = vrm.humanoid.getNormalizedBoneNode(footName);
  if (!upperLeg || !lowerLeg || !foot) {
    return undefined;
  }

  return {
    upperLeg,
    lowerLeg,
    foot,
    previousPosition: null,
    lockPosition: new THREE.Vector3(),
    lockRotation: new THREE.Quaternion(),
    locked: false,
    weight: 0
  };
}

function rotateJointToward(
  joint: THREE.Object3D,
  effector: THREE.Object3D,
  targetWorld: THREE.Vector3,
  strength: number
): void {
  joint.updateWorldMatrix(true, true);
  const jointPosition = getWorldPosition(joint);
  const effectorDirection = getWorldPosition(effector).sub(jointPosition);
  const targetDirection = targetWorld.clone().sub(jointPosition);
  if (effectorDirection.lengthSq() < 1e-8 || targetDirection.lengthSq() < 1e-8) {
    return;
  }

  const deltaWorld = new THREE.Quaternion().setFromUnitVectors(
    effectorDirection.normalize(),
    targetDirection.normalize()
  );
  deltaWorld.slerp(new THREE.Quaternion(), 1 - THREE.MathUtils.clamp(strength, 0, 1));
  const parentWorld = joint.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
  const localCorrection = parentWorld.clone().invert().multiply(deltaWorld).multiply(parentWorld);
  joint.quaternion.premultiply(localCorrection);
  joint.updateWorldMatrix(true, true);
}

function setWorldQuaternion(node: THREE.Object3D, targetWorld: THREE.Quaternion, weight: number): void {
  const currentWorld = node.getWorldQuaternion(new THREE.Quaternion());
  const blendedWorld = currentWorld.slerp(targetWorld, THREE.MathUtils.clamp(weight, 0, 1));
  const parentWorld = node.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
  node.quaternion.copy(parentWorld.invert().multiply(blendedWorld));
  node.updateWorldMatrix(false, true);
}

function getWorldPosition(node: THREE.Object3D): THREE.Vector3 {
  return node.getWorldPosition(new THREE.Vector3());
}

function horizontalDistance(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
