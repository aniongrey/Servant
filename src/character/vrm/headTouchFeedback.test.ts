import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { defaultAvatarFitConfig } from '../ik/AvatarFitConfig';
import { isHeadHit } from './headTouchFeedback';

describe('head touch hit test', () => {
  it('requires the first visible model surface to be inside the scaled head collider', () => {
    const scene = new THREE.Group();
    scene.scale.setScalar(0.1);
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.5), new THREE.MeshBasicMaterial());
    body.position.y = 0.5;
    scene.add(body);
    const head = new THREE.Object3D();
    head.position.y = 1.5;
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.12), new THREE.MeshBasicMaterial());
    head.add(headMesh);
    scene.add(head);

    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
    camera.position.set(0, 0.08, 3.4);
    camera.lookAt(0, 0.08, 0);
    const canvas = {
      getBoundingClientRect: () =>
        ({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200 } as DOMRect)
    } as HTMLCanvasElement;
    const vrm = {
      scene,
      humanoid: { getNormalizedBoneNode: (name: string) => (name === 'head' ? head : null) }
    } as never;
    const eventAt = (point: THREE.Vector3) => {
      const projected = point.clone().project(camera);
      return {
        clientX: (projected.x + 1) * 100,
        clientY: (1 - projected.y) * 100
      } as PointerEvent;
    };

    expect(isHeadHit(eventAt(new THREE.Vector3(0, 0.05, 0)), canvas, camera, vrm, defaultAvatarFitConfig)).toBe(
      false
    );
    expect(isHeadHit(eventAt(new THREE.Vector3(0, 0.15, 0)), canvas, camera, vrm, defaultAvatarFitConfig)).toBe(
      true
    );
  });
});
