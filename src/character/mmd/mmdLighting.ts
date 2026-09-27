import { Color, DirectionalLight, Mesh, type HemisphereLight, type Material, type Object3D } from 'three';
import { syncMmdSpecularDirection } from '@yohawing/three-mmd-loader/three';

const ambientStates = new WeakMap<Material, { scale: number; original?: Color; uniform?: Color }>();

/** MMD shaders bypass Three's scene lights; synchronize their own light uniforms. */
export function applyMmdLighting(root: Object3D, main: DirectionalLight, ambient: HemisphereLight) {
  const key = new DirectionalLight();
  main.getWorldPosition(key.position);
  main.target.getWorldPosition(key.target.position);
  key.color.copy(main.color);
  // Calibrate the UI's default 3.0 to MMD's authored 154/255 key light, avoiding clipping.
  key.intensity = Math.max(0, main.intensity) * (154 / 255) / 3;
  key.visible = main.visible;
  const seen = new Set<Material>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const materials: Material[] = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material.userData.mmdMaterialFactors?.shaderApplied || seen.has(material)) continue;
      seen.add(material);
      let state = ambientStates.get(material);
      if (!state) {
        state = { scale: 1 };
        ambientStates.set(material, state);
        const current = state;
        const beforeCompile = material.onBeforeCompile;
        material.onBeforeCompile = function (shader, renderer) {
          beforeCompile.call(this, shader, renderer);
          const value = shader.uniforms.mmdMaterialAmbient?.value;
          if (value instanceof Color) {
            current.original = value.clone();
            current.uniform = value;
            value.multiplyScalar(current.scale);
          }
        };
        material.needsUpdate = true;
      }
      state.scale = ambient.visible ? Math.max(0, ambient.intensity) / 0.92 : 0;
      if (state.original && state.uniform) state.uniform.copy(state.original).multiplyScalar(state.scale);
      syncMmdSpecularDirection(material, key);
    }
  });
}
