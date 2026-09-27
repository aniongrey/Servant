import { expect, it } from 'vitest';
import { Color, Mesh, MeshToonMaterial, Scene, ShaderLib, type WebGLRenderer } from 'three';
import { attachMmdMaterialFactors } from '@yohawing/three-mmd-loader/three';
import { applyRenderConfig, defaultCharacterRenderConfig, setupCharacterLighting } from '../vrm/CharacterRenderConfig';

it('updates MMD key direction, intensity and ambient before and after shader compilation without compounding', () => {
  const scene = new Scene();
  const material = new MeshToonMaterial();
  material.userData.mmdMaterial = { ambient: [0.2, 0.3, 0.4] };
  attachMmdMaterialFactors(material);
  scene.add(new Mesh(undefined, material));
  const lighting = setupCharacterLighting(scene);
  const config = { ...defaultCharacterRenderConfig, mainLightIntensity: 1.5, ambientLightIntensity: 0.46 };
  applyRenderConfig([], lighting, config);
  const shader = { ...ShaderLib.toon, uniforms: {} } as Parameters<typeof material.onBeforeCompile>[0];
  material.onBeforeCompile(shader, {} as WebGLRenderer);
  expect(shader.uniforms.mmdLightColor.value.r).toBeCloseTo(lighting.mainLight.color.r * (154 / 255) / 2);
  expect(shader.uniforms.mmdMaterialAmbient.value).toEqual(new Color().setRGB(0.1, 0.15, 0.2));
  applyRenderConfig([], lighting, config);
  expect(shader.uniforms.mmdMaterialAmbient.value.r).toBeCloseTo(0.1);
  lighting.mainLight.position.x = -2;
  applyRenderConfig([], lighting, { ...config, mainLightIntensity: 0, ambientLightIntensity: 0 });
  expect(shader.uniforms.mmdLightDirection.value.x).toBeLessThan(0);
  expect(shader.uniforms.mmdLightColor.value.r).toBe(0);
  expect(shader.uniforms.mmdMaterialAmbient.value.r).toBe(0);
  applyRenderConfig([], lighting, defaultCharacterRenderConfig);
  expect(shader.uniforms.mmdMaterialAmbient.value.r).toBeCloseTo(0.2);
});
