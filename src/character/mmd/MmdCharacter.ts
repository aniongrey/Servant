import {
  VRM, VRMHumanoid, VRMExpression, VRMExpressionManager, VRMExpressionMorphTargetBind,
  type VRMHumanBones, type VRMHumanBoneName
} from '@pixiv/three-vrm';
import { Group, Quaternion, Vector3, type Bone, type SkinnedMesh } from 'three';
import {
  ThreeMmdLoader,
  disposeMmdModel,
  type TextureMap,
  type ThreeMmdModel,
  type ThreeMmdLoaderOptions
} from '@yohawing/three-mmd-loader/three';
import { DefaultMmdRuntime } from '@yohawing/three-mmd-loader/runtime';
import type { CustomBulletMmdPhysicsBackend } from '@yohawing/three-mmd-loader/physics';
import { throwIfAborted } from '../../app/utils/delay';
import { EMPTY_MMD_ANIMATION, createMmdPhysicsBackend } from './mmdPhysics';
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
  private readonly boneRotationOverrides = new Map<Bone, Quaternion>();
  private readonly followers: Array<{ target: Bone; driver: Bone }>;
  private readonly parentRotation = new Quaternion();
  private readonly driverRotation = new Quaternion();
  private readonly physics: CustomBulletMmdPhysicsBackend | undefined;
  private elapsedSeconds = 0;

  constructor(readonly mmd: ThreeMmdModel, options: MmdCharacterOptions = {}) {
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
    const unitScale = 1.5 / height;
    mmd.root.scale.setScalar(unitScale);
    mmd.root.position.y = -bounds.min.y * mmd.root.scale.y;
    // 这次缩放是单位换算，不是「角色被画小了」。命中判定按世界单位算半径，读骨骼世界
    // 缩放时必须先除掉它，否则 PMX 的命中胶囊会细成几毫米（VRM 侧读不到这个字段 = 1）。
    scene.userData.modelUnitScale = unitScale;
    scene.add(mmd.root);
    scene.updateMatrixWorld(true);
    const humanoid = createMmdHumanoid(mmd.mesh);
    scene.add(humanoid.normalizedHumanBonesRoot);
    const expressionManager = createMmdExpressionManager(mmd.mesh);
    super({ scene, humanoid, expressionManager,
      meta: { metaVersion: '1', name: 'MMD adapter', authors: [], licenseUrl: '' }
    });
    this.physics = options.physics;
    if (this.physics) {
      // 认领 mesh 必须晚于上面的 A→T 归一化：runtime 在这一刻把当前姿态记成 rest，
      // 也就是物理的静止位。绑完立刻清掉动画，否则每帧的 VMD 求值会盖掉 VRMA。
      mmd.runtime.setAnimation(EMPTY_MMD_ANIMATION, mmd.mesh);
      mmd.runtime.clearAnimation();
    }
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
    if (this.physics) {
      // 物理把「当前骨骼世界矩阵」当刚体的目标位，所以它必须排在姿态更新与付与之
      // 后；`ik: false` 是因为腿的姿势由 VRMA 给，再跑 MMD 的足 IK 会和它抢。
      // 时间只增不减：Bullet 用秒差积分，回退会被当成 seek（只播种不推进），
      // 而 desktop 的 actor 调度在离屏恢复时只给一个整帧。
      this.elapsedSeconds += delta;
      this.stepPhysics();
      // 物理写回的是骨骼局部变换，蒙皮前必须让世界矩阵跟上，否则这一帧画的还是旧姿态。
      this.scene.updateMatrixWorld(true);
    }
    // Procedural ear/hair poses own the final rotation while their action is active.
    // Bullet still simulates the rest of the model normally.
    for (const [bone, rotation] of this.boneRotationOverrides) bone.quaternion.copy(rotation);
    if (this.boneRotationOverrides.size) this.scene.updateMatrixWorld(true);
    this.mmd.mesh.skeleton.update();
    // Do not call mmd.update here: its VMD evaluator would overwrite VRMA and expression weights.
  }

  setBoneRotationOverride(bone: Bone, rotation: Quaternion | null): void {
    if (rotation) {
      const saved = this.boneRotationOverrides.get(bone) ?? new Quaternion();
      this.boneRotationOverrides.set(bone, saved.copy(rotation));
    } else this.boneRotationOverrides.delete(bone);
  }

  /**
   * 在模型空间里步进物理。
   *
   * Bullet 拿骨骼的**世界矩阵**定位刚体，而刚体的尺寸 / 质量取自 PMX 的原始单位 ——
   * 加载器把 `body.shape.size` 与 `body.localTranslation` 原样喂进 Bullet
   * （`mmdAnimBullet.js` 的 `ensureModel`），不做任何单位还原。PMX 作者单位又各不相同
   * （这个模型 22 单位高），于是 `mmd.root` 上那句 1.5 m 适配缩放会让两边尺度对不上：
   * 物理世界里的模型只剩 1.5 单位高，刚体却还是 22 单位世界里的尺寸，相对大了 15 倍。
   * 静态碰撞体（身体）彼此重叠，把头发和裙子挤得甩飞几米且永不收敛。
   *
   * 步进期间把角色放回原始尺度，算完再摆回舞台尺度；只改矩阵、不改骨骼的局部变换，
   * 所以蒙皮结果不受影响。
   */
  private stepPhysics(): void {
    const { root } = this.mmd;
    const scale = root.scale.x;
    const height = root.position.y;
    root.scale.setScalar(1);
    root.position.y = 0;
    try {
      root.updateMatrixWorld(true);
      this.mmd.runtime.evaluate(this.elapsedSeconds, { physics: true, ik: false });
    } finally {
      // 摆回舞台尺度；世界矩阵由调用方那次 `scene.updateMatrixWorld(true)` 一并重算。
      root.scale.setScalar(scale);
      root.position.y = height;
    }
  }

  dispose(): void {
    this.physics?.dispose?.();
    disposeMmdModel(this.mmd);
  }
}

export interface MmdCharacterOptions {
  /** Bullet 物理后端（头发 / 裙子）。缺省时保持静止，见 `mmdPhysics.ts`。 */
  readonly physics?: CustomBulletMmdPhysicsBackend;
}

/**
 * PMX 的 loader 选项。
 *
 * 固定用 `DefaultMmdRuntime`，不用默认的 mmd-anim wasm runtime：姿态由 VRMA 给，VMD 求值
 * 全程用不上，而 `DefaultMmdRuntime` 在没有动画时会明确跳过姿态求值，只跑付与和物理 ——
 * wasm runtime 则会拿它的 clip 去覆盖骨骼，正是 VRMA 驱动最怕的事。
 */
export function createMmdLoaderOptions(
  physics?: CustomBulletMmdPhysicsBackend,
  textures?: TextureMap
): ThreeMmdLoaderOptions {
  return {
    runtimeFactory: () => new DefaultMmdRuntime(
      physics ? { physics: 'external', physicsBackend: physics } : undefined
    ),
    // Only set for imported folders: a model scanned out of `public/assets` keeps the
    // loader's own "textures sit next to the model URL" rule, which already works.
    ...(textures ? { textureMap: textures } : {})
  };
}

/**
 * A PMX whose files are not on a URL.
 *
 * An imported model folder arrives as bytes rather than a path — the model and
 * its textures are unpacked from the stored container — so the loader has to be
 * given the textures as an explicit map. Paths are the ones the PMX spells in
 * its material table (`textures/xxx.png`, `toon2.png`), which is exactly what
 * the loader looks up before falling back to the adjacent-path rule.
 */
export interface MmdModelSource {
  readonly model: Uint8Array;
  readonly textures: TextureMap;
}

export async function loadMmdCharacter(
  source: string | MmdModelSource,
  signal?: AbortSignal
): Promise<MmdCharacter> {
  // 物理后端只能在 runtime 建立时给（`runtimeFactory` 在 loadModel 内部同步调用），所以
  // wasm 要先到位；module 是全局缓存的，只有第一个角色付出这个代价。
  const physics = await createMmdPhysicsBackend();
  const loader = new ThreeMmdLoader(
    createMmdLoaderOptions(physics, typeof source === 'string' ? undefined : source.textures)
  );
  const model = await loader.loadModel(typeof source === 'string' ? source : source.model, { signal });
  try {
    throwIfAborted(signal);
    return new MmdCharacter(model, { physics });
  } catch (error) {
    physics?.dispose?.();
    disposeMmdModel(model);
    throw error;
  }
}
