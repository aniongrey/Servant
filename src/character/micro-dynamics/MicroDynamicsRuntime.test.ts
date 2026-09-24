import * as THREE from 'three';
import {
  VRM,
  VRMHumanoid,
  VRMExpressionManager,
  VRMExpression,
  VRMExpressionMorphTargetBind,
  type VRMHumanBones
} from '@pixiv/three-vrm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import rawConfig from './micro-dynamics.json';
import { parseMicroDynamicsConfig } from './config';
import { MicroDynamicsRuntime } from './MicroDynamicsRuntime';

function createRuntime(parentRotation = 0, expressionManager?: VRMExpressionManager) {
  const scene = new THREE.Group();
  const hips = new THREE.Object3D();
  const head = new THREE.Object3D();
  const leftEye = new THREE.Object3D();
  const rightEye = new THREE.Object3D();
  scene.add(hips);
  hips.add(head);
  head.rotation.z = parentRotation;
  head.add(leftEye, rightEye);
  scene.updateMatrixWorld(true);
  const humanoid = new VRMHumanoid({
    hips: { node: hips },
    head: { node: head },
    leftEye: { node: leftEye },
    rightEye: { node: rightEye }
  } as VRMHumanBones);
  const vrm = new VRM({
    scene,
    humanoid,
    expressionManager,
    meta: { metaVersion: '1', name: 'test', authors: ['test'], licenseUrl: '' }
  });
  const config = parseMicroDynamicsConfig(structuredClone(rawConfig));
  const runtime = new MicroDynamicsRuntime(vrm, config);
  return { runtime, config, vrm, leftEye, head, eye: humanoid.getNormalizedBoneNode('leftEye')! };
}

describe('MicroDynamicsRuntime gaze', () => {
  afterEach(() => vi.restoreAllMocks());
  it('preserves speech expression and mouth weights when used as an overlay', () => {
    const manager = new VRMExpressionManager();
    manager.registerExpression(new VRMExpression('happy'));
    manager.registerExpression(new VRMExpression('aa'));
    const { vrm, config } = createRuntime(0, manager);
    const runtime = new MicroDynamicsRuntime(vrm, config, true);
    manager.setValue('happy', 0.8);
    manager.setValue('aa', 0.6);
    runtime.play('blink');
    runtime.update(0.1);
    expect(manager.getValue('happy')).toBe(0.8);
    expect(manager.getValue('aa')).toBe(0.6);
  });
  it('composes independent actions and lets gaze return replace the previous gaze', () => {
    const { runtime, eye } = createRuntime();
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    runtime.play('gazeShiftX');
    runtime.play('earFocus');
    runtime.update(0.55);
    expect(eye.rotation.y).toBeCloseTo(THREE.MathUtils.degToRad(7));
    runtime.play('gazeReturn');
    runtime.update(0.3);
    runtime.update(0.1);
    expect(eye.rotation.y).toBeCloseTo(0);
  });
  it.each([0, Math.PI / 2])('preserves both axes on a rig with parent rotation %s', (rotation) => {
    const { runtime, eye, leftEye, head, vrm } = createRuntime(rotation);
    runtime.setState('thinking');
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.9);
    runtime.play('gazeShiftX');
    runtime.update(0.55);
    expect(eye.rotation.x).toBeCloseTo(THREE.MathUtils.degToRad(4));
    expect(eye.rotation.y).toBeCloseTo(THREE.MathUtils.degToRad(7));
    const expectedWorldRotation = eye.quaternion.clone().multiply(head.quaternion);
    expect(leftEye.getWorldQuaternion(new THREE.Quaternion()).angleTo(expectedWorldRotation)).toBeCloseTo(0);
    vrm.update(0);
    expect(eye.rotation.y).toBeCloseTo(THREE.MathUtils.degToRad(7));
  });

  it.each([0.1, 0.9])('returns smoothly from either direction and from downward gaze (%s)', (random) => {
    const { runtime, config, eye } = createRuntime();
    config.states[0].values = { eyeLeftX: 6, eyeRightX: 6 };
    vi.spyOn(Math, 'random').mockReturnValueOnce(random);
    runtime.play('gazeShiftX');
    runtime.update(0.55);
    const yaw = eye.rotation.y;
    runtime.play('gazeReturn');
    runtime.update(0);
    expect(eye.rotation.y).toBeCloseTo(yaw);
    expect(eye.rotation.x).toBeCloseTo(THREE.MathUtils.degToRad(6));
    runtime.update(0.15);
    expect(eye.rotation.y).toBeCloseTo(yaw * 0.25);
    expect(eye.rotation.x).toBeCloseTo(THREE.MathUtils.degToRad(1.5));
    runtime.update(0.15);
    expect(eye.rotation.y).toBeCloseTo(0);
    expect(eye.rotation.x).toBeCloseTo(0);
  });

  it('keeps rest rotations when applying config during playback', () => {
    const { runtime, config, eye } = createRuntime();
    runtime.play('gazeShiftX');
    runtime.update(0.55);
    runtime.setConfig(config);
    runtime.update(0);
    expect(eye.rotation.y).toBeCloseTo(0);
    runtime.play('gazeShiftDown');
    runtime.update(0.5);
    expect(eye.rotation.x).toBeCloseTo(THREE.MathUtils.degToRad(6));
    runtime.reset();
    expect(eye.rotation.x).toBeCloseTo(0);
  });
});

describe('MicroDynamicsRuntime eye widening', () => {
  function createFace(names = ['32.びっくり', 'open']) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    geometry.morphAttributes.position = names.map(() => new THREE.Float32BufferAttribute([0, 1, 0], 3));
    const face = new THREE.Mesh(geometry);
    face.morphTargetDictionary = Object.fromEntries(names.map((name, index) => [name, index]));
    return face;
  }

  it.each([
    ['eyeWide', 0.35, 0.42],
    ['surpriseWide', 0.15, 0.85]
  ] as const)('plays %s using the actual eye shape when surprised is empty', (id, seconds, weight) => {
    const manager = new VRMExpressionManager();
    manager.registerExpression(new VRMExpression('surprised'));
    const { runtime, config, vrm } = createRuntime(0, manager);
    const face = createFace();
    vrm.scene.add(face);
    runtime.setConfig(config);
    expect(
      runtime.diagnostics().expressionBindings.find((item) => item.logical === 'eyeWide')?.available
    ).toBe(true);
    runtime.play(id);
    runtime.update(seconds);
    expect(face.morphTargetInfluences![0]).toBeCloseTo(weight);
    expect(face.morphTargetInfluences![1]).toBe(0);
    runtime.update(1);
    expect(face.morphTargetInfluences![0]).toBe(0);
    runtime.setConfig(config);
    expect(
      manager.expressions.filter((expression) => expression.expressionName === 'microDynamics:eyeWide')
    ).toHaveLength(1);
    runtime.dispose();
    expect(manager.getExpression('microDynamics:eyeWide')).toBeNull();
    expect(face.morphTargetInfluences![0]).toBe(0);
  });

  it('falls back to an existing bound expression on other models', () => {
    const manager = new VRMExpressionManager();
    const face = createFace(['otherEyeShape']);
    const expression = new VRMExpression('surprised');
    expression.addBind(new VRMExpressionMorphTargetBind({ primitives: [face], index: 0, weight: 1 }));
    manager.registerExpression(expression);
    const { runtime } = createRuntime(0, manager);
    runtime.play('eyeWide');
    runtime.update(0.35);
    expect(face.morphTargetInfluences![0]).toBeCloseTo(0.42);
  });

  it('marks an empty expression without a supported eye shape as unavailable', () => {
    const manager = new VRMExpressionManager();
    manager.registerExpression(new VRMExpression('surprised'));
    const { runtime } = createRuntime(0, manager);
    expect(
      runtime.diagnostics().expressionBindings.find((item) => item.logical === 'eyeWide')?.available
    ).toBe(false);
  });
});
