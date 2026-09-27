import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { defaultAvatarFitConfig } from '../ik/AvatarFitConfig';
import { createModelHitTest, createVrmHitTest } from './modelHitTest';

describe('vrm hit test', () => {
  const canvas = {
    getBoundingClientRect: () =>
      ({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200 } as DOMRect)
  } as HTMLCanvasElement;

  function setup() {
    const scene = new THREE.Group();
    const hips = new THREE.Group();
    hips.position.y = 0.9;
    const neck = new THREE.Group();
    neck.position.y = 0.35;
    const head = new THREE.Group();
    head.position.y = 0.15;
    const leftUpperArm = new THREE.Group();
    leftUpperArm.position.set(0.15, 0.3, 0);
    const leftLowerArm = new THREE.Group();
    leftLowerArm.position.set(0, -0.3, 0);
    neck.add(head);
    hips.add(neck, leftUpperArm);
    leftUpperArm.add(leftLowerArm);
    scene.add(hips);
    const nodes: Record<string, THREE.Object3D> = { hips, neck, head, leftUpperArm, leftLowerArm };
    const vrm = {
      scene,
      humanoid: { getRawBoneNode: (name: string) => nodes[name] ?? null }
    } as never;
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
    camera.position.set(0, 0.78, 3.4);
    camera.lookAt(0, 0.78, 0);
    return {
      vrm,
      camera,
      scene,
      hips,
      hit: createVrmHitTest(vrm, camera, canvas, () => defaultAvatarFitConfig)
    };
  }

  function screenPoint(point: THREE.Vector3, camera: THREE.Camera) {
    const projected = point.clone().project(camera);
    return { x: (projected.x + 1) * 100, y: (1 - projected.y) * 100 };
  }

  it('tells a head tap from a body tap and a miss', () => {
    const { hit, camera } = setup();
    const head = screenPoint(new THREE.Vector3(0, 1.4, 0), camera);
    expect(hit(head.x, head.y)).toBe('head');
    const arm = screenPoint(new THREE.Vector3(0.15, 1.2, 0), camera);
    expect(hit(arm.x, arm.y)).toBe('body');
    expect(hit(4, 4)).toBeNull();
    expect(hit(-5, 100)).toBeNull();
  });

  it('scales the hit volume with the bones', () => {
    const { hit, camera, scene, hips } = setup();
    // 未缩时：头心上方 0.15 仍在头部命中半径（0.116 × 1.7）里。
    const edge = screenPoint(new THREE.Vector3(0, 1.55, 0), camera);
    expect(hit(edge.x, edge.y)).toBe('head');

    hips.scale.setScalar(0.6);
    scene.updateMatrixWorld(true);
    const shrunkenCenter = screenPoint(new THREE.Vector3(0, 1.2, 0), camera);
    expect(hit(shrunkenCenter.x, shrunkenCenter.y)).toBe('head');
    // 头心也一样高了 0.15，但命中半径只有 0.6 倍 —— 不跟着缩就会把角色周围的空白算成摸头。
    const shrunkenEdge = screenPoint(new THREE.Vector3(0, 1.35, 0), camera);
    expect(hit(shrunkenEdge.x, shrunkenEdge.y)).toBeNull();
  });

  /**
   * PMX / PMD 这类格式的适配器会把整身等比换算到米制，于是**每根**骨骼的世界缩放都带上
   * 那个换算系数；命中半径是世界单位，得把它除掉。不除的话 MMD 的命中区只有几个像素宽，
   * 桌宠窗口就几乎不接受指针事件（滚轮缩放、拖窗口全部失效）。
   */
  it('sees through a format adapter unit conversion instead of reading it as a shrunken character', () => {
    const unitScale = 0.068; // 22.05 PMX 单位 → 1.5 m
    const build = (declared: boolean) => {
      const scene = new THREE.Group();
      const scaledRoot = new THREE.Group();
      scaledRoot.scale.setScalar(unitScale);
      // 画出来仍是米制大小：头离轴 0.1 m，躯干胶囊离轴 0.35 m（在头部半径之外）。
      const head = new THREE.Group();
      head.position.set(0.1 / unitScale, 0, 0);
      const hips = new THREE.Group();
      hips.position.set(0.35 / unitScale, -0.1 / unitScale, 0);
      const neck = new THREE.Group();
      neck.position.set(0, 0.2 / unitScale, 0);
      hips.add(neck);
      scaledRoot.add(head, hips);
      scene.add(scaledRoot);
      scene.updateMatrixWorld(true);
      if (declared) scene.userData.modelUnitScale = unitScale;
      const nodes: Record<string, THREE.Object3D> = { head, hips, neck };
      const vrm = {
        scene,
        humanoid: { getRawBoneNode: (name: string) => nodes[name] ?? null }
      } as never;
      const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
      camera.position.z = 3;
      camera.lookAt(0, 0, 0);
      return { hit: createVrmHitTest(vrm, camera, canvas, () => defaultAvatarFitConfig), camera };
    };

    const declared = build(true);
    const undeclared = build(false);
    // 离骨骼 0.05 m：在米制半径里（头 0.187、躯干 0.18），乘上那个换算系数（≈0.012）则不在。
    const near = (point: THREE.Vector3, camera: THREE.Camera) => {
      const centre = screenPoint(point, camera);
      return { x: centre.x + 7, y: centre.y };
    };
    const head = new THREE.Vector3(0.1, 0, 0);
    const torso = new THREE.Vector3(0.35, 0, 0);
    const headCentre = screenPoint(head, declared.camera);
    const torsoCentre = screenPoint(torso, declared.camera);
    expect(declared.hit(headCentre.x, headCentre.y)).toBe('head');
    expect(declared.hit(torsoCentre.x, torsoCentre.y)).toBe('body');

    const headNear = near(head, declared.camera);
    const torsoNear = near(torso, declared.camera);
    expect(declared.hit(headNear.x, headNear.y)).toBe('head');
    expect(declared.hit(torsoNear.x, torsoNear.y)).toBe('body');
    // 同一个点，只把声明去掉（= 修复前的行为）：半径缩到 0.068 倍，7px 外就落空了。
    expect(undeclared.hit(headNear.x, headNear.y)).toBeNull();
    expect(undeclared.hit(torsoNear.x, torsoNear.y)).toBeNull();
  });
});

describe('object hit test', () => {
  const canvas = {
    getBoundingClientRect: () =>
      ({ left: 10, top: 20, right: 210, bottom: 220, width: 200, height: 200 } as DOMRect)
  };
  function setup() {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.z = 3;
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    root.add(mesh);
    return { root, mesh, hit: createModelHitTest(root, camera, canvas) };
  }
  it('accepts model geometry, but passes through canvas background and points outside the canvas', () => {
    const { hit } = setup();
    expect(hit(110, 120)).toBe('body');
    expect(hit(15, 25)).toBeNull();
    expect(hit(-10, 120)).toBeNull();
  });
  it('follows model transforms and ignores hidden or fully transparent meshes', () => {
    const { mesh, root, hit } = setup();
    root.position.x = 5;
    expect(hit(110, 120)).toBeNull();
    root.position.x = 0;
    mesh.material.transparent = true;
    mesh.material.opacity = 0;
    expect(hit(110, 120)).toBeNull();
    mesh.material.opacity = 1;
    root.visible = false;
    expect(hit(110, 120)).toBeNull();
    root.visible = true;
    expect(hit(110, 120)).toBe('body');
  });
});
