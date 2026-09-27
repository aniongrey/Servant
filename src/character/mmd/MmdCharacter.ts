import {
  VRM, VRMHumanoid, VRMExpression, VRMExpressionManager, VRMExpressionMorphTargetBind,
  type VRMHumanBones, type VRMHumanBoneName
} from '@pixiv/three-vrm';
import { Group, Quaternion, Vector3, type Bone, type SkinnedMesh } from 'three';
import { ThreeMmdLoader, disposeMmdModel, type ThreeMmdModel } from '@yohawing/three-mmd-loader/three';
import { throwIfAborted } from '../../app/utils/delay';
import expressionMap from './expression-map.json';

export const mmdBoneMap: Partial<Record<VRMHumanBoneName, string>> = {
  hips: 'センター', spine: '上半身', chest: '上半身1', upperChest: '上半身2', neck: '首', head: '頭',
  leftEye: '左目', rightEye: '右目'
};
for (const [side, prefix] of [['left', '左'], ['right', '右']] as const) {
  for (const [suffix, name] of Object.entries({
    Shoulder: '肩', UpperArm: '腕', LowerArm: 'ひじ', Hand: '手首',
    UpperLeg: '足', LowerLeg: 'ひざ', Foot: '足首', Toes: 'つま先',
    ThumbMetacarpal: '親指０', ThumbProximal: '親指１', ThumbDistal: '親指２'
  })) mmdBoneMap[`${side}${suffix}` as VRMHumanBoneName] = prefix + name;
  for (const [finger, name] of Object.entries({ Index: '人指', Middle: '中指', Ring: '薬指', Little: '小指' })) {
    ['Proximal', 'Intermediate', 'Distal'].forEach((joint, index) => {
      mmdBoneMap[`${side}${finger}${joint}` as VRMHumanBoneName] = prefix + name + ['１', '２', '３'][index];
    });
  }
}

/** Shared VRM expression API: emotions, micro-blinks, gaze and lip sync keep their existing owners. */
export function createMmdExpressionManager(mesh: SkinnedMesh): VRMExpressionManager {
  const manager = new VRMExpressionManager();
  const missing: string[] = [];
  for (const [name, definition] of Object.entries(expressionMap.expressions)) {
    const expression = new VRMExpression(name);
    for (const [morph, weight] of Object.entries(definition.morphs)) {
      const index = mesh.morphTargetDictionary?.[morph];
      if (index === undefined) { missing.push(`${name}: ${morph}`); continue; }
      expression.addBind(new VRMExpressionMorphTargetBind({ primitives: [mesh], index, weight }));
    }
    manager.registerExpression(expression);
  }
  mesh.userData.missingExpressionMappings = missing;
  if (missing.length) console.warn('MMD 表情映射缺少 Morph:', missing.join(', '));
  return manager;
}

export function createMmdHumanoid(mesh: SkinnedMesh): VRMHumanoid {
  const bones = new Map(mesh.skeleton.bones.map(bone => [bone.userData.mmdBoneName || bone.name, bone]));
  const humanBones = {} as VRMHumanBones;
  for (const [key, name] of Object.entries(mmdBoneMap)) {
    const bone = bones.get(name);
    if (bone) {
      // English PMX names can repeat; animation tracks require unique names.
      bone.name = `MMD_${key}`;
      humanBones[key as VRMHumanBoneName] = { node: bone };
    }
  }
  const required: VRMHumanBoneName[] = ['hips', 'spine', 'head', 'leftUpperArm', 'leftLowerArm', 'leftHand',
    'rightUpperArm', 'rightLowerArm', 'rightHand', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
    'rightUpperLeg', 'rightLowerLeg', 'rightFoot'];
  const missing = required.filter(name => !humanBones[name]);
  if (missing.length) throw new Error(`MMD 骨骼无法映射: ${missing.join(', ')}。请在 mmdBoneMap 中配置模型骨骼名。`);

  // Normalize the MMD A-pose to VRMA's T-pose before three-vrm captures its rest rig.
  // Keep bind inverses untouched: changing them would deform the original mesh.
  for (const side of ['left', 'right'] as const) {
    const axis = new Vector3(side === 'left' ? 1 : -1, 0, 0);
    for (const [parent, child] of [['UpperArm', 'LowerArm'], ['LowerArm', 'Hand']] as const) {
      const bone = humanBones[`${side}${parent}`]!.node;
      const tip = humanBones[`${side}${child}`]!.node;
      const from = tip.getWorldPosition(new Vector3()).sub(bone.getWorldPosition(new Vector3())).normalize();
      const world = new Quaternion().setFromUnitVectors(from, axis).multiply(bone.getWorldQuaternion(new Quaternion()));
      bone.quaternion.copy(bone.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(world));
      bone.updateWorldMatrix(false, true);
    }
  }
  return new VRMHumanoid(humanBones);
}

/** MMD rendering with a real three-vrm humanoid/expressions adapter, not a VRM file conversion. */
export class MmdCharacter extends VRM {
  private readonly followers: Array<{ target: Bone; driver: Bone }>;
  private readonly parentRotation = new Quaternion();
  private readonly driverRotation = new Quaternion();

  constructor(readonly mmd: ThreeMmdModel) {
    mmd.update(0);
    mmd.mesh.skeleton.pose();
    const scene = new Group();
    scene.name = 'MMD Character';
    scene.userData.modelFormat = 'mmd';
    // PMX units vary by author. Fit the rest mesh to the stage's 1.5 m character height.
    mmd.mesh.geometry.computeBoundingBox();
    const bounds = mmd.mesh.geometry.boundingBox!;
    const height = bounds.max.y - bounds.min.y;
    if (!Number.isFinite(height) || height <= 0) throw new Error('MMD 模型尺寸无效');
    mmd.root.scale.setScalar(1.5 / height);
    mmd.root.position.y = -bounds.min.y * mmd.root.scale.y;
    scene.add(mmd.root);
    scene.updateMatrixWorld(true);
    const humanoid = createMmdHumanoid(mmd.mesh);
    scene.add(humanoid.normalizedHumanBonesRoot);
    const expressionManager = createMmdExpressionManager(mmd.mesh);
    super({ scene, humanoid, expressionManager,
      meta: { metaVersion: '1', name: 'MMD adapter', authors: [], licenseUrl: '' }
    });
    const bones = new Map(mmd.mesh.skeleton.bones.map(bone => [bone.userData.mmdBoneName || bone.name, bone]));
    this.followers = mmd.mesh.skeleton.bones.flatMap(target => {
      const name = target.userData.mmdBoneName as string | undefined;
      const driver = name && /(?:足|ひざ|足首)D$/.test(name) ? bones.get(name.slice(0, -1)) : undefined;
      return driver ? [{ target, driver }] : [];
    });
    const faceMaterials = new Set(['眼高光', '眼睛', '眼白', '眉毛', '睫毛']);
    for (const material of Array.isArray(mmd.mesh.material) ? mmd.mesh.material : [mmd.mesh.material]) {
      if (!faceMaterials.has(material.name)) continue;
      material.transparent = false;
      material.depthWrite = true;
      material.alphaTest = 0.5;
      material.alphaToCoverage = true;
      material.needsUpdate = true;
    }
    this.update(0);
  }

  override update(delta: number): void {
    super.update(delta);
    this.scene.updateMatrixWorld(true);
    // D bones are the actual leg deformers on semi-standard MMD rigs.
    for (const { target, driver } of this.followers) {
      target.quaternion.copy(target.parent!.getWorldQuaternion(this.parentRotation).invert()
        .multiply(driver.getWorldQuaternion(this.driverRotation)));
      target.updateWorldMatrix(false, true);
    }
    this.mmd.mesh.skeleton.update();
    // Do not call mmd.update here: its VMD evaluator would overwrite VRMA and expression weights.
  }

  dispose(): void { disposeMmdModel(this.mmd); }
}

export async function loadMmdCharacter(url: string, signal?: AbortSignal): Promise<MmdCharacter> {
  const model = await new ThreeMmdLoader().loadModel(url, { signal });
  try {
    throwIfAborted(signal);
    return new MmdCharacter(model);
  } catch (error) {
    disposeMmdModel(model);
    throw error;
  }
}
