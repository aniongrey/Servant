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
