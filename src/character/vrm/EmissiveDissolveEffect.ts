import * as THREE from 'three';

const NOISE_GLSL = `
float dissolveHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float dissolveNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dissolveHash(i), dissolveHash(i + vec3(1,0,0)), f.x),
                 mix(dissolveHash(i + vec3(0,1,0)), dissolveHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(dissolveHash(i + vec3(0,0,1)), dissolveHash(i + vec3(1,0,1)), f.x),
                 mix(dissolveHash(i + vec3(0,1,1)), dissolveHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}`;

export interface EmissiveDissolveEffect {
  setProgress(progress: number): void;
  dispose(): void;
}

export function createEmissiveDissolveEffect(root: THREE.Object3D): EmissiveDissolveEffect {
  const bounds = new THREE.Box3().setFromObject(root);
  const uniforms = {
    progress: { value: 0 },
    minY: { value: bounds.min.y },
    maxY: { value: bounds.max.y },
    edgeColor: { value: new THREE.Color(0xffb51f) }
  };
  const restores: Array<() => void> = [];
  const materials = new Set<THREE.Material>();

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const list = Array.isArray(object.material) ? object.material : [object.material];
    list.forEach((material) => materials.add(material));
  });

  materials.forEach((material) => {
    const originalCompile = material.onBeforeCompile;
    const originalCacheKey = material.customProgramCacheKey;
    material.onBeforeCompile = (shader, renderer) => {
      originalCompile.call(material, shader, renderer);
      shader.uniforms.uDissolveProgress = uniforms.progress;
      shader.uniforms.uDissolveMinY = uniforms.minY;
      shader.uniforms.uDissolveMaxY = uniforms.maxY;
      shader.uniforms.uDissolveEdgeColor = uniforms.edgeColor;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vDissolveWorldPosition;')
        .replace(
          '#include <project_vertex>',
          'vDissolveWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <project_vertex>'
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vDissolveWorldPosition;
uniform float uDissolveProgress;
uniform float uDissolveMinY;
uniform float uDissolveMaxY;
uniform vec3 uDissolveEdgeColor;
${NOISE_GLSL}`
        )
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
float dissolveScan = mix(uDissolveMinY - 0.08, uDissolveMaxY + 0.08, uDissolveProgress);
float dissolveValue = dissolveScan - vDissolveWorldPosition.y + (dissolveNoise(vDissolveWorldPosition * 18.0) - 0.5) * 0.18;
if (dissolveValue < 0.0) discard;
float dissolveEdge = 1.0 - smoothstep(0.0, 0.075, dissolveValue);
gl_FragColor.rgb = mix(gl_FragColor.rgb, uDissolveEdgeColor * 3.2, dissolveEdge);`
        );
    };
    material.customProgramCacheKey = () => `${originalCacheKey.call(material)}|emissive-dissolve-v1`;
    material.needsUpdate = true;
    restores.push(() => {
      material.onBeforeCompile = originalCompile;
      material.customProgramCacheKey = originalCacheKey;
      material.needsUpdate = true;
    });
  });

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    restores.forEach((restore) => restore());
  };

  return {
    setProgress(progress) {
      if (disposed) return;
      uniforms.progress.value = THREE.MathUtils.clamp(progress, 0, 1);
      // Completion removes the height-based glow, including from later animated poses.
      if (uniforms.progress.value >= 1) dispose();
    },
    dispose
  };
}
