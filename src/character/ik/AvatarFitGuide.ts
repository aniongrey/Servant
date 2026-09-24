import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import type { AvatarFitConfig } from './AvatarFitConfig';

const GUIDE_X = -0.48;
const ARM_Y_OFFSET = -0.04;

export class AvatarFitGuide {
  readonly group = new THREE.Group();

  private readonly heightLine = createLine(0x247c78);
  private readonly shoulderLine = createLine(0xc47a22);
  private readonly leftArmLine = createLine(0xc94f65);
  private readonly rightArmLine = createLine(0xc94f65);
  private readonly footLine = createLine(0x4e7f42);
  private readonly frontPushMinHeightLine = createLine(0x2f7df6);
  private readonly colliders = {
    head: createColliderMesh(0x247c78),
    torso: createTorsoColliderMesh(0xc94f65)
  };
  private readonly leftWristAxes = new THREE.AxesHelper(0.12);
  private readonly rightWristAxes = new THREE.AxesHelper(0.12);

  constructor(private readonly vrm: VRM) {
    this.group.name = 'Avatar Fit Guide';
    this.group.add(
      this.heightLine,
      this.shoulderLine,
      this.leftArmLine,
      this.rightArmLine,
      this.footLine,
      this.frontPushMinHeightLine,
      this.colliders.head,
      this.colliders.torso,
      this.leftWristAxes,
      this.rightWristAxes
    );
  }

  update(config: AvatarFitConfig): void {
    this.updateHeightLine(config.height);
    this.updateFootLine(config.footGroundOffset);
    this.updateShoulderLine(config.shoulderWidth);
    this.updateArmLines(config);
    this.updateHeadCollider(config);
    this.updateTorsoCollider(config);
    this.updateFrontPushMinHeightLine(config);
    this.updateWristAxes('leftHand', this.leftWristAxes, config);
    this.updateWristAxes('rightHand', this.rightWristAxes, config);
  }

  dispose(): void {
    disposeLine(this.heightLine);
    disposeLine(this.shoulderLine);
    disposeLine(this.leftArmLine);
    disposeLine(this.rightArmLine);
    disposeLine(this.footLine);
    disposeLine(this.frontPushMinHeightLine);
    Object.values(this.colliders).forEach((mesh) => {
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
  }

  private updateHeightLine(height: number): void {
    setLinePoints(this.heightLine, new THREE.Vector3(GUIDE_X, 0, 0), new THREE.Vector3(GUIDE_X, height, 0));
  }

  private updateFootLine(offset: number): void {
    setLinePoints(this.footLine, new THREE.Vector3(-0.36, offset, 0), new THREE.Vector3(0.36, offset, 0));
  }

  private updateShoulderLine(width: number): void {
    const center =
      getBonePosition(this.vrm, 'upperChest') ??
      getBonePosition(this.vrm, 'chest') ??
      new THREE.Vector3(0, 1.16, 0);
    setLinePoints(
      this.shoulderLine,
      new THREE.Vector3(center.x - width / 2, center.y, center.z),
      new THREE.Vector3(center.x + width / 2, center.y, center.z)
    );
  }

  private updateArmLines(config: AvatarFitConfig): void {
    const chest =
      getBonePosition(this.vrm, 'upperChest') ??
      getBonePosition(this.vrm, 'chest') ??
      new THREE.Vector3(0, 1.16, 0);
    const y = chest.y + ARM_Y_OFFSET;
    const halfShoulder = config.shoulderWidth / 2;
    const leftStart = new THREE.Vector3(chest.x - halfShoulder, y, chest.z);
    const rightStart = new THREE.Vector3(chest.x + halfShoulder, y, chest.z);

    setLinePoints(
      this.leftArmLine,
      leftStart,
      leftStart.clone().add(new THREE.Vector3(-config.armLength, 0, 0))
    );
    setLinePoints(
      this.rightArmLine,
      rightStart,
      rightStart.clone().add(new THREE.Vector3(config.armLength, 0, 0))
    );
  }

  private updateHeadCollider(config: AvatarFitConfig): void {
    const mesh = this.colliders.head;
    const position = getFirstBonePosition(this.vrm, ['head']) ?? new THREE.Vector3();
    const radius = config.colliders.head.radius;
    mesh.visible = radius > 0;

    if (!mesh.visible) {
      return;
    }

    mesh.position.set(position.x, config.colliders.head.height, position.z);
    mesh.scale.setScalar(radius);
  }

  private updateTorsoCollider(config: AvatarFitConfig): void {
    const mesh = this.colliders.torso;
    const torso = config.colliders.torso;
    const topHeight = Math.max(torso.topHeight, torso.bottomHeight);
    const bottomHeight = Math.min(torso.topHeight, torso.bottomHeight);
    const height = Math.max(0.001, topHeight - bottomHeight);
    const center = getTorsoCenterXZ(this.vrm);

    mesh.visible = torso.topRadius > 0 || torso.bottomRadius > 0;
    if (!mesh.visible) {
      return;
    }

    mesh.geometry.dispose();
    mesh.geometry = new THREE.CylinderGeometry(torso.topRadius, torso.bottomRadius, height, 32, 1, true);
    mesh.position.set(center.x, bottomHeight + height / 2, center.z);
  }

  private updateFrontPushMinHeightLine(config: AvatarFitConfig): void {
    const height = getFirstFrontPushMinHeight(config);
    const torsoCenter = getTorsoCenterXZ(this.vrm);

    this.frontPushMinHeightLine.visible = Number.isFinite(height);
    if (!this.frontPushMinHeightLine.visible) {
      return;
    }

    setLinePoints(
      this.frontPushMinHeightLine,
      new THREE.Vector3(torsoCenter.x - 0.42, height, torsoCenter.z),
      new THREE.Vector3(torsoCenter.x + 0.42, height, torsoCenter.z)
    );
  }

  private updateWristAxes(boneName: VRMHumanBoneName, axes: THREE.AxesHelper, config: AvatarFitConfig): void {
    const bone = this.vrm.humanoid.getNormalizedBoneNode(boneName);
    axes.visible = Boolean(bone);

    if (!bone) {
      return;
    }

    const offset = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(config.wristRotationOffset.x),
        THREE.MathUtils.degToRad(config.wristRotationOffset.y),
        THREE.MathUtils.degToRad(config.wristRotationOffset.z),
        'XYZ'
      )
    );
    bone.updateWorldMatrix(true, false);
    axes.position.setFromMatrixPosition(bone.matrixWorld);
    axes.quaternion.setFromRotationMatrix(bone.matrixWorld).multiply(offset);
  }
}

function getBonePosition(vrm: VRM, boneName: VRMHumanBoneName): THREE.Vector3 | null {
  const bone = vrm.humanoid.getNormalizedBoneNode(boneName);

  if (!bone) {
    return null;
  }

  bone.updateWorldMatrix(true, false);
  return new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
}

function getFirstBonePosition(vrm: VRM, boneNames: VRMHumanBoneName[]): THREE.Vector3 | null {
  for (const boneName of boneNames) {
    const position = getBonePosition(vrm, boneName);

    if (position) {
      return position;
    }
  }

  return null;
}

function getTorsoCenterXZ(vrm: VRM): THREE.Vector3 {
  const positions = ['upperChest', 'chest', 'spine', 'hips']
    .map((boneName) => getBonePosition(vrm, boneName as VRMHumanBoneName))
    .filter((position): position is THREE.Vector3 => Boolean(position));

  if (positions.length === 0) {
    return new THREE.Vector3();
  }

  return positions
    .reduce((sum, position) => sum.add(position), new THREE.Vector3())
    .multiplyScalar(1 / positions.length);
}

function getFirstFrontPushMinHeight(config: AvatarFitConfig): number {
  return config.handIk.frontPushMinHeight;
}

function createLine(color: number): THREE.Line {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.82
    })
  );
  line.renderOrder = 21;
  return line;
}

function setLinePoints(line: THREE.Line, start: THREE.Vector3, end: THREE.Vector3): void {
  line.geometry.setFromPoints([start, end]);
}

function disposeLine(line: THREE.Line): void {
  line.geometry.dispose();
  (line.material as THREE.Material).dispose();
}

function createColliderMesh(color: number): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 12),
    new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.18,
      wireframe: true
    })
  );
  mesh.renderOrder = 20;
  return mesh;
}

function createTorsoColliderMesh(color: number): THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial> {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.18, 0.33, 32, 1, true),
    new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.24,
      wireframe: true
    })
  );
  mesh.renderOrder = 20;
  return mesh;
}
