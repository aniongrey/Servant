import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import {
  AnimationMixer, Bone, BufferGeometry, Float32BufferAttribute, Group, MeshBasicMaterial,
  PerspectiveCamera, Skeleton, SkinnedMesh, Texture, Vector3
} from 'three';
import { ThreeMmdLoader } from '@yohawing/three-mmd-loader/three';
import type { CustomBulletMmdPhysicsBackend, MmdPhysicsStepContext } from '@yohawing/three-mmd-loader/physics';
import { VRMHumanBoneParentMap, type VRMHumanBoneName } from '@pixiv/three-vrm';
import { createMmdExpressionManager, createMmdHumanoid, createMmdLoaderOptions, mmdBoneMap, MmdCharacter } from './MmdCharacter';
import { VrmExpressionPlaybackAdapter } from '../expression/VrmExpressionPlaybackAdapter';
import { VrmaLoader } from '../motion/VrmaLoader';
import { createVrmHitTest } from '../vrm/modelHitTest';
import { setCameraZoomKeepingFootPosition } from '../vrm/stageRendering';
import { DEFAULT_CAMERA_ZOOM } from '../vrm/cameraZoom';
import { defaultAvatarFitConfig } from '../ik/AvatarFitConfig';
import expressionMap from './expression-map.json';
import microDynamicsConfig from '../micro-dynamics/micro-dynamics.json';
import { MicroDynamicsRuntime } from '../micro-dynamics/MicroDynamicsRuntime';
import { parseMicroDynamicsConfig } from '../micro-dynamics/config';

describe('MMD character adapter', () => {
  it('uses the existing emotion API without erasing mouth or blink channels', () => {
    const mesh = new SkinnedMesh();
    const morphs = [...new Set(Object.values(expressionMap.expressions).flatMap(value => Object.keys(value.morphs)))];
    mesh.morphTargetDictionary = Object.fromEntries(morphs.map((name, index) => [name, index]));
    mesh.morphTargetInfluences = morphs.map(() => 0);
    const expressionManager = createMmdExpressionManager(mesh);
    const face = new VrmExpressionPlaybackAdapter({ expressionManager } as MmdCharacter);
    expressionManager.setValue('aa', 0.4);
    expressionManager.setValue('blinkLeft', 0.2);
    face.setExpression('happy', 0.8);
    const value = (name: string) => mesh.morphTargetInfluences![mesh.morphTargetDictionary![name]];
    expect(value('Fcl_ALL_Joy')).toBeCloseTo(0.8);
    expect(value('Fcl_MTH_A')).toBeCloseTo(0.4);
    face.setExpression('neutral', 1);
    expect(value('Fcl_ALL_Joy')).toBe(0);
    expect(value('Fcl_EYE_Close_L')).toBeCloseTo(0.2);
    face.setExpression('relaxed', 1);
    expect(value('Fcl_ALL_Fun')).toBeCloseTo(0.6);
    face.setExpression('fun', 1);
    expect(value('Fcl_ALL_Fun')).toBeCloseTo(1);
  });

  it('calibrates an A-pose in metres and follows stage rotation without changing bind matrices', () => {
    const mesh = new SkinnedMesh(new BufferGeometry(), new MeshBasicMaterial());
    mesh.geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
    const nodes = new Map<VRMHumanBoneName, Bone>();
    for (const [key, name] of Object.entries(mmdBoneMap)) {
      const bone = new Bone();
      bone.name = name;
      bone.userData.mmdBoneName = name;
      nodes.set(key as VRMHumanBoneName, bone);
    }
    for (const [key, bone] of nodes) {
      (nodes.get(VRMHumanBoneParentMap[key]!) ?? mesh).add(bone);
      bone.position.y = key === 'hips' ? 8 : 1;
      if (/Arm|Hand/.test(key)) bone.position.set(key.startsWith('left') ? 2 : -2, -1, 0);
    }
    mesh.bind(new Skeleton([...nodes.values()]));
    const inverses = mesh.skeleton.boneInverses.map(matrix => matrix.clone());
    const root = new Group(); root.scale.setScalar(0.1); root.add(mesh);
    const scene = new Group(); scene.add(root); scene.updateMatrixWorld(true);
    const rig = createMmdHumanoid(mesh); scene.add(rig.normalizedHumanBonesRoot);
    expect(rig.getNormalizedBoneNode('hips')!.position.y).toBeCloseTo(0.8);
    const direction = nodes.get('leftHand')!.getWorldPosition(new Vector3())
      .sub(nodes.get('leftLowerArm')!.getWorldPosition(new Vector3())).normalize();
    expect(direction.x).toBeCloseTo(1);
    rig.getNormalizedBoneNode('leftUpperArm')!.rotation.z = 0.3;
    scene.rotation.y = 1.2; scene.updateMatrixWorld(true); rig.update(); scene.updateMatrixWorld(true);
    expect(nodes.get('hips')!.position.y).toBeCloseTo(8);
    expect(nodes.get('leftUpperArm')!.quaternion.toArray().every(Number.isFinite)).toBe(true);
    expect(mesh.skeleton.boneInverses).toEqual(inverses);
  });
});

// Optional local acceptance: the user's licensed PMX stays outside Git.
const modelPath = 'public/assets/character/blue-fish-mmd/蓝色大肥鱼1.12.pmx';

const textureLoader = { load(_url: string, onLoad?: (texture: Texture) => void) {
  const texture = new Texture(); queueMicrotask(() => onLoad?.(texture)); return texture;
} };

const loadRealPmx = (physics?: CustomBulletMmdPhysicsBackend) =>
  new ThreeMmdLoader({ textureLoader, ...createMmdLoaderOptions(physics) })
    .loadModel(new Uint8Array(readFileSync(modelPath)));

it.skipIf(!existsSync(modelPath))('binds micro dynamics to the real PMX face morphs, ears and ahoge', async () => {
  let simulatedBones: Bone[] = [];
  const physics = {
    name: 'pose-overwriting-backend', disabled: false, disposed: false,
    step: () => {
      for (const bone of simulatedBones)
        if (/CatEar2_|Hair1_10/.test(bone.name)) bone.quaternion.identity();
      return { simulated: false, updatedBoneCount: 0 };
    }
  } as unknown as CustomBulletMmdPhysicsBackend;
  const model = await loadRealPmx(physics);
  simulatedBones = model.mesh.skeleton.bones;
  const character = new MmdCharacter(model, { physics });
  const runtime = new MicroDynamicsRuntime(character, parseMicroDynamicsConfig(microDynamicsConfig));
  try {
    const bindings = runtime.diagnostics();
    for (const logical of ['eyeSquint', 'eyeWide', 'browRaise', 'browDown', 'smallSmile', 'mouthPress', 'lookLeft', 'lookRight', 'lookDown'])
      expect(bindings.expressionBindings.find(binding => binding.logical === logical)?.available, logical).toBe(true);
    for (const [logical, actual] of [['earLeft', 'J_Opt_L_CatEar2_02'], ['earRight', 'J_Opt_R_CatEar2_01'], ['ahoge', 'J_Sec_Hair1_10']]) {
      const binding = bindings.boneBindings.find(item => item.logical === logical);
      expect(binding?.available, logical).toBe(true);
      expect(binding?.actual).toContain(actual);
    }
    const morphWeight = (name: string) => character.mmd.mesh.morphTargetInfluences![character.mmd.mesh.morphTargetDictionary![name]!];
    runtime.play('gazeShiftX');
    runtime.update(0.55);
    expect(morphWeight('EyeLeft') + morphWeight('EyeRight')).toBeGreaterThan(0);
    runtime.play('gazeReturn');
    runtime.update(0.3);
    expect(morphWeight('EyeLeft') + morphWeight('EyeRight')).toBeCloseTo(0);
    runtime.play('gazeShiftDown');
    runtime.update(0.5);
    expect(morphWeight('EyeDown')).toBeGreaterThan(0);
    for (const [action, name, duration] of [['earTwitch', 'J_Opt_L_CatEar2_02', 0.13], ['ahogeSway', 'J_Sec_Hair1_10', 0.225]] as const) {
      runtime.reset();
      const bone = character.mmd.mesh.skeleton.bones.find(item => item.userData.mmdBoneName === name)!;
      const rest = bone.rotation.z;
      runtime.play(action);
      runtime.update(duration);
      character.update(duration);
      expect(bone.rotation.z, action).not.toBeCloseTo(rest);
      const index = character.mmd.mesh.skeleton.bones.indexOf(bone);
      const { skinIndex, skinWeight } = character.mmd.mesh.geometry.attributes;
      expect(Array.from(skinIndex.array).some((value, offset) => value === index && skinWeight.array[offset] > 0), action).toBe(true);
    }
  } finally {
    runtime.dispose();
    character.dispose();
  }
}, 60000);

it.skipIf(!existsSync(modelPath))('retargets all installed VRMA clips onto the real PMX with finite, repeatable poses', async () => {
  const model = await loadRealPmx();
  const character = new MmdCharacter(model);
  try {
    expect(model.mesh.userData.missingExpressionMappings).toEqual([]);
    const loader = new VrmaLoader(character, { fetcher: async (input) => {
      const bytes = readFileSync(String(input));
      return new Response(bytes);
    } });
    const directory = 'public/assets/motions/vrma';
    const files = readdirSync(directory).filter(file => file.endsWith('.vrma'));
    expect(files.length).toBeGreaterThan(0);
    const mixer = new AnimationMixer(character.scene);
    for (const file of files) {
      const loaded = await loader.load({ id: file, url: `${directory}/${file}`, loop: 'once', defaultFadeIn: 0,
        defaultFadeOut: 0, interruptible: true, returnToIdle: false, tags: [], durationMs: 0 });
      const action = mixer.clipAction(loaded.clip!); action.play();
      mixer.setTime(loaded.clip!.duration / 2); character.update(0);
      const first = model.mesh.skeleton.bones.map(bone => bone.matrixWorld.toArray());
      expect(first.flat().every(Number.isFinite), file).toBe(true);
      mixer.setTime(loaded.clip!.duration / 2); character.update(0);
      const second = model.mesh.skeleton.bones.map(bone => bone.matrixWorld.toArray());
      second.forEach((matrix, index) => matrix.forEach((value, component) => expect(value, file).toBeCloseTo(first[index][component], 5)));
      mixer.stopAllAction(); mixer.uncacheClip(loaded.clip!);
    }
  } finally { character.dispose(); }
}, 60000);

// 命中半径是世界单位，而 PMX 的单位换算会把每根骨骼的世界缩放都乘上 0.068。不告知命中判定
// 这是单位换算，桌宠窗口的指针事件（滚轮缩放、拖窗口）就只在几毫米宽的胶囊里生效。
it.skipIf(!existsSync(modelPath))('declares the PMX unit conversion so the hit volume matches the rendered body', async () => {
  const model = await loadRealPmx();
  const character = new MmdCharacter(model);
  try {
    const unitScale: unknown = character.scene.userData.modelUnitScale;
    expect(unitScale).toBeCloseTo(model.root.scale.x, 10);
    expect(unitScale as number).toBeLessThan(0.5);
    character.scene.updateMatrixWorld(true);

    const width = 400, height = 600;
    const camera = new PerspectiveCamera(28, width / height, 0.1, 20);
    camera.position.set(0, 0.78, 3.4);
    setCameraZoomKeepingFootPosition(camera, DEFAULT_CAMERA_ZOOM, 0.78);
    camera.updateMatrixWorld(true);
    const canvas = {
      getBoundingClientRect: () =>
        ({ left: 0, top: 0, right: width, bottom: height, width, height }) as DOMRect
    } as unknown as HTMLCanvasElement;
    const hitAt = () =>
      createVrmHitTest(character, camera, canvas, () => defaultAvatarFitConfig);
    const project = (point: Vector3) => {
      const projected = point.clone().project(camera);
      return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height };
    };
    const bonePoint = (name: VRMHumanBoneName) =>
      character.humanoid.getRawBoneNode(name)!.getWorldPosition(new Vector3());
    const spineMiddle = bonePoint('hips').add(bonePoint('neck')).multiplyScalar(0.5);

    const onSpine = project(spineMiddle);
    expect(hitAt()(onSpine.x, onSpine.y)).toBe('body');
    // 离脊柱 4 cm：仍在米制的躯干半径（0.18 m）内 —— 桌宠上就是「鼠标还在角色身上」。
    const besideSpine = project(spineMiddle.clone().add(new Vector3(0.04, 0, 0)));
    expect(hitAt()(besideSpine.x, besideSpine.y)).toBe('body');
    const saved = character.scene.userData.modelUnitScale;
    delete character.scene.userData.modelUnitScale;
    // 修复前就是这样：半径缩到 0.068 倍（≈3 mm），同一个点上已经判不出命中了。
    expect(hitAt()(besideSpine.x, besideSpine.y)).toBeNull();
    character.scene.userData.modelUnitScale = saved;
  } finally { character.dispose(); }
}, 60000);

// 头发和裙子的刚体链只在 `MmdRuntime.setAnimation` 认领 mesh 之后才读得到；没有它，
// `stepExternalPhysics` 第一行就 `return`，物理后端一次都不会被调用。
it.skipIf(!existsSync(modelPath))('hands the PMX rigid bodies to the Bullet backend once the runtime owns the mesh', async () => {
  const frames: MmdPhysicsStepContext[] = [];
  let disposed = false;
  const physics = {
    name: 'recording-backend',
    disabled: false,
    disposed: false,
    step: (context: MmdPhysicsStepContext) => {
      frames.push(context);
      return { simulated: false, updatedBoneCount: 0 };
    },
    dispose: () => { disposed = true; }
  } as unknown as CustomBulletMmdPhysicsBackend;

  const model = await loadRealPmx(physics);
  const character = new MmdCharacter(model, { physics });
  try {
    // 构造里那次 update(0) 已经把物理接上了；它的首次 evaluate 是播种（reset + settle）。
    expect(frames.length).toBeGreaterThan(0);
    const first = frames[0]!;
    expect(first.skeleton!.bones.length).toBe(model.mesh.skeleton.bones.length);
    expect(first.seeking).toBe(true);
    const names = first.rigidBodies!.map(body => body.name ?? '');
    // 这个模型把头发做成了 dynamicBone 链，裙子做成了 dynamic 盒链；两者都得读进来。
    expect(names.filter(name => /Hair/i.test(name)).length).toBeGreaterThan(0);
    expect(names.filter(name => /^(dress|Skirt)/i.test(name)).length).toBeGreaterThan(0);
    expect(first.joints!.length).toBeGreaterThan(0);

    frames.length = 0;
    character.update(1 / 60);
    character.update(1 / 60);
    expect(frames).toHaveLength(2);
    // 时间必须只增不减：Bullet 用秒差积分，秒数回退会被当成 seek（只播种不推进）。
    expect(frames[1]!.seconds).toBeGreaterThan(frames[0]!.seconds);
    expect(frames[1]!.deltaSeconds).toBeCloseTo(1 / 60, 6);
  } finally { character.dispose(); }
  expect(disposed).toBe(true);
}, 60000);

it.skipIf(!existsSync(modelPath))('steps physics in model space so the PMX unit scale cannot shrink the rigid bodies', async () => {
  const frames: MmdPhysicsStepContext[] = [];
  const physics = {
    name: 'recording-backend',
    disabled: false,
    disposed: false,
    step: (context: MmdPhysicsStepContext) => {
      frames.push(context);
      return { simulated: false, updatedBoneCount: 0 };
    }
  } as unknown as CustomBulletMmdPhysicsBackend;

  const model = await loadRealPmx(physics);
  const character = new MmdCharacter(model, { physics });
  try {
    const unitScale = model.root.scale.x;
    // 这个模型有 22 个 PMX 单位高，适配到 1.5 m 之后缩放远小于 1。
    expect(unitScale).toBeLessThan(0.5);

    // 刚体尺寸取自 PMX 原始单位，所以喂给 Bullet 的世界矩阵也必须是原始尺度。
    // 带着 0.068 进去，物理会以为模型只有 1.5 单位高，头发和裙子会甩飞几米。
    const world = frames.at(-1)!.inputWorldMatricesColumnMajor!;
    const boneScales = [];
    for (let index = 0; index < 24; index++) {
      const base = index * 16;
      boneScales.push(Math.hypot(world[base], world[base + 1], world[base + 2]));
    }
    boneScales.sort((left, right) => left - right);
    expect(boneScales[12]).toBeCloseTo(1, 4);

    // 步进结束必须摆回舞台尺度，否则角色会顶着 22 单位的身高去渲染。
    character.scene.updateMatrixWorld(true);
    expect(model.root.scale.x).toBeCloseTo(unitScale, 10);
    const rendered = model.root.matrixWorld.elements;
    expect(Math.hypot(rendered[0], rendered[1], rendered[2])).toBeCloseTo(unitScale, 5);
  } finally { character.dispose(); }
}, 60000);

it.skipIf(!existsSync(modelPath))('leaves the runtime untouched when no physics backend is supplied', async () => {
  const model = await loadRealPmx();
  const character = new MmdCharacter(model);
  const evaluate = vi.spyOn(model.runtime, 'evaluate');
  const setAnimation = vi.spyOn(model.runtime, 'setAnimation');
  try {
    character.update(1 / 60);
    expect(evaluate).not.toHaveBeenCalled();
    expect(setAnimation).not.toHaveBeenCalled();
  } finally { character.dispose(); }
}, 60000);
