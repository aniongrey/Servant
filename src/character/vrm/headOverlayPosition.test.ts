import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { updateHeadOverlayPosition } from './stageRendering';

describe('head overlays', () => {
  it('follows the transformed head when the avatar moves and scales', () => {
    const root = new THREE.Group();
    const head = new THREE.Object3D();
    root.add(head);
    const vrm = { humanoid: { getNormalizedBoneNode: () => head } } as never;
    const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 10);
    camera.position.z = 5;
    camera.updateMatrixWorld();
    const overlay = { style: {} } as HTMLDivElement;
    updateHeadOverlayPosition(vrm, camera, overlay, 0.2);
    expect(parseFloat(overlay.style.left)).toBeCloseTo(50);
    expect(parseFloat(overlay.style.top)).toBeCloseTo(45);
    root.position.set(1, 0.5, 0);
    root.scale.setScalar(2);
    updateHeadOverlayPosition(vrm, camera, overlay, 0.2);
    expect(parseFloat(overlay.style.left)).toBeCloseTo(75);
    expect(parseFloat(overlay.style.top)).toBeCloseTo(27.5);
    head.position.x = -0.5;
    updateHeadOverlayPosition(vrm, camera, overlay, 0.2);
    expect(parseFloat(overlay.style.left)).toBeCloseTo(50);
  });
});
