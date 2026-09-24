import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { createVrmHitTest } from './modelHitTest';
import { defaultAvatarFitConfig } from '../ik/AvatarFitConfig';

it('hits moving bone capsules without reading or raycasting rendered geometry', () => {
  const scene = new THREE.Group();
  const head = new THREE.Bone();
  scene.add(head);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  scene.add(mesh);
  const raycast = vi.spyOn(mesh, 'raycast');
  const vrm = {
    scene,
    humanoid: { getRawBoneNode: (name: string) => (name === 'head' ? head : null) }
  } as unknown as VRM;
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.z = 3;
  let config = structuredClone(defaultAvatarFitConfig);
  const hit = createVrmHitTest(
    vrm,
    camera,
    {
      getBoundingClientRect: () =>
        ({ left: 10, top: 20, right: 210, bottom: 220, width: 200, height: 200 } as DOMRect)
    },
    () => config
  );
  expect(hit(110, 120)).toBe(true);
  expect(hit(15, 25)).toBe(false);
  expect(hit(-10, 120)).toBe(false);
  head.position.x = 2;
  expect(hit(110, 120)).toBe(false);
  head.position.x = 0;
  scene.position.x = 2;
  expect(hit(110, 120)).toBe(false);
  scene.position.x = 0;
  scene.visible = false;
  expect(hit(110, 120)).toBe(false);
  scene.visible = true;
  config.colliders.head.radius = 0;
  expect(hit(110, 120)).toBe(false);
  config = structuredClone(defaultAvatarFitConfig);
  expect(hit(110, 120)).toBe(true);
  expect(raycast).not.toHaveBeenCalled();
});
