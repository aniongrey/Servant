import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createModelHitTest } from './modelHitTest';

describe('desktop model hit test', () => {
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
    expect(hit(110, 120)).toBe(true);
    expect(hit(15, 25)).toBe(false);
    expect(hit(-10, 120)).toBe(false);
  });
  it('follows model transforms and ignores hidden or fully transparent meshes', () => {
    const { mesh, root, hit } = setup();
    root.position.x = 5;
    expect(hit(110, 120)).toBe(false);
    root.position.x = 0;
    mesh.material.transparent = true;
    mesh.material.opacity = 0;
    expect(hit(110, 120)).toBe(false);
    mesh.material.opacity = 1;
    root.visible = false;
    expect(hit(110, 120)).toBe(false);
    root.visible = true;
    expect(hit(110, 120)).toBe(true);
  });
});
