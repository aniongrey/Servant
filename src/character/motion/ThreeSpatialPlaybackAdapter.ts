import * as THREE from 'three';
import type { SpatialPlaybackAdapter, SpatialState } from '../../app/runtimeTypes';

export class ThreeSpatialPlaybackAdapter implements SpatialPlaybackAdapter {
  constructor(private readonly root: THREE.Object3D, private readonly baseRotationY = Math.PI) {}

  applySpatial(state: SpatialState): void {
    const worldX = (state.x - 50) / 22;
    const worldY = (50 - state.y) / 36;

    this.root.position.x = worldX;
    this.root.position.y = worldY;
    this.root.scale.setScalar(state.scale);

    if (state.facing === 'left') {
      this.root.rotation.y = this.baseRotationY + 0.45;
    } else if (state.facing === 'right') {
      this.root.rotation.y = this.baseRotationY - 0.45;
    } else {
      this.root.rotation.y = this.baseRotationY;
    }
  }
}
