import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { AnimationMixer, Bone, BufferGeometry, Float32BufferAttribute, Group, MeshBasicMaterial, Skeleton, SkinnedMesh, Texture, Vector3 } from 'three';
import { ThreeMmdLoader } from '@yohawing/three-mmd-loader/three';
import { VRMHumanBoneParentMap, type VRMHumanBoneName } from '@pixiv/three-vrm';
import { createMmdExpressionManager, createMmdHumanoid, mmdBoneMap, MmdCharacter } from './MmdCharacter';
import { VrmExpressionPlaybackAdapter } from '../expression/VrmExpressionPlaybackAdapter';
import { VrmaLoader } from '../motion/VrmaLoader';
import expressionMap from './expression-map.json';

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
it.skipIf(!existsSync(modelPath))('retargets all installed VRMA clips onto the real PMX with finite, repeatable poses', async () => {
  const textureLoader = { load(_url: string, onLoad?: (texture: Texture) => void) {
    const texture = new Texture(); queueMicrotask(() => onLoad?.(texture)); return texture;
  } };
  const model = await new ThreeMmdLoader({ textureLoader }).loadModel(new Uint8Array(readFileSync(modelPath)));
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
