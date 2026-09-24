import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

export interface CharacterRenderConfig {
  mtoonShadeEnabled: boolean;
  shadingShift: number;
  shadingToony: number;
  shadeStrength: number;

  rimEnabled: boolean;
  rimStrength: number;
  rimFresnelPower: number;

  outlineEnabled: boolean;
  outlineWidth: number;
  outlineDarkness: number;

  backShadowEnabled: boolean;
  backShadowOffsetX: number;
  backShadowOffsetY: number;
  backShadowBlur: number;
  backShadowOpacity: number;

  contactShadowEnabled: boolean;
  contactShadowOpacity: number;
  contactShadowWidth: number;
  contactShadowDepth: number;
  contactShadowHeightFade: number;

  hairHighlightEnabled: boolean;
  hairHighlightStrength: number;

  mtoonAoEnabled: boolean;
  mtoonAoStrength: number;

  mainLightIntensity: number;
  ambientLightIntensity: number;
}

// 初始参数（2026-09-23 定型）：MToon 描边 + 背光/接触阴影全开，主光 3.0、环境补光 0.92，
// 刘海高光关闭。改这里等于改所有未保存过渲染配置的用户的起点。
export const defaultCharacterRenderConfig: CharacterRenderConfig = {
  mtoonShadeEnabled: true,
  shadingShift: -0.05,
  shadingToony: 0.85,
  shadeStrength: 0.75,
  rimEnabled: true,
  rimStrength: 0.4,
  rimFresnelPower: 2.5,
  outlineEnabled: true,
  outlineWidth: 0.005,
  outlineDarkness: 0.92,
  backShadowEnabled: true,
  backShadowOffsetX: -22,
  backShadowOffsetY: 8,
  backShadowBlur: 0,
  backShadowOpacity: 0.34,
  contactShadowEnabled: true,
  contactShadowOpacity: 0.28,
  contactShadowWidth: 0.62,
  contactShadowDepth: 0.34,
  contactShadowHeightFade: 0.5,
  hairHighlightEnabled: false,
  hairHighlightStrength: 0.24,
  mtoonAoEnabled: true,
  mtoonAoStrength: 0.32,
  mainLightIntensity: 3,
  ambientLightIntensity: 0.92
};

export interface CharacterLighting {
  mainLight: THREE.DirectionalLight;
  mainLightTarget: THREE.Object3D;
  ambientLight: THREE.HemisphereLight;
}

export interface CharacterMaterialSetup {
  surfaceMaterial: MToonMaterialLike;
  outlineMaterial?: MToonMaterialLike;
  originalShadeColor: THREE.Color;
  originalShadingShift: number;
  originalShadingToony: number;
  originalMatcapFactor: THREE.Color;
  originalMatcapTexture: THREE.Texture | null;
  isHairMaterial: boolean;
  isEyeMaterial: boolean;
}

export function setupMToonMaterials(vrm: VRM): CharacterMaterialSetup[] {
  const setups: CharacterMaterialSetup[] = [];

  vrm.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    const materials = getMaterialList(object.material);
    for (const material of materials) {
      if (!isMToonSurfaceMaterial(material)) {
        continue;
      }

      setups.push({
        surfaceMaterial: material,
        outlineMaterial: findOrCreateOutlineMaterial(object, material),
        originalShadeColor: material.shadeColorFactor.clone(),
        originalShadingShift: material.shadingShiftFactor,
        originalShadingToony: material.shadingToonyFactor,
        originalMatcapFactor: material.matcapFactor.clone(),
        originalMatcapTexture: material.matcapTexture,
        isHairMaterial: isHairMaterial(object, material),
        isEyeMaterial: isEyeMaterial(object, material)
      });
    }
  });

  return setups;
}

export function setupCharacterLighting(scene: THREE.Scene): CharacterLighting {
  const mainLight = new THREE.DirectionalLight(0xfff2df, defaultCharacterRenderConfig.mainLightIntensity);
  mainLight.name = 'Character Main Toon Light';
  mainLight.position.set(0.75, 2.6, 3.2);

  const mainLightTarget = new THREE.Object3D();
  mainLightTarget.name = 'Character Main Toon Light Target';
  mainLightTarget.position.set(0, 0.95, 0);
  mainLight.target = mainLightTarget;

  const ambientLight = new THREE.HemisphereLight(
    0xfffbf2,
    0xd6c9b7,
    defaultCharacterRenderConfig.ambientLightIntensity
  );
  ambientLight.name = 'Character Soft Hemisphere Light';

  scene.add(mainLightTarget);
  scene.add(mainLight);
  scene.add(ambientLight);

  return { mainLight, mainLightTarget, ambientLight };
}

export function applyRenderConfig(
  materialSetups: CharacterMaterialSetup[],
  lighting: CharacterLighting,
  config: CharacterRenderConfig,
  hairHighlightTexture?: THREE.Texture | null,
  _mtoonAoTexture?: THREE.Texture | null
): void {
  lighting.mainLight.intensity = config.mainLightIntensity;
  lighting.ambientLight.intensity = config.ambientLightIntensity;

  for (const setup of materialSetups) {
    applySurfaceConfig(setup, config, hairHighlightTexture);
    applyOutlineConfig(setup.outlineMaterial, config);
  }
}

interface MToonMaterialLike extends THREE.Material {
  isMToonMaterial?: true;
  isOutline?: boolean;
  shadeColorFactor: THREE.Color;
  shadingShiftFactor: number;
  shadingToonyFactor: number;
  rimLightingMixFactor: number;
  parametricRimColorFactor: THREE.Color;
  parametricRimFresnelPowerFactor: number;
  parametricRimLiftFactor: number;
  matcapFactor: THREE.Color;
  matcapTexture: THREE.Texture | null;
  outlineWidthMode: 'none' | 'worldCoordinates' | 'screenCoordinates';
  outlineWidthFactor: number;
  outlineColorFactor: THREE.Color;
  outlineLightingMixFactor: number;
}

function applySurfaceConfig(
  setup: CharacterMaterialSetup,
  config: CharacterRenderConfig,
  hairHighlightTexture?: THREE.Texture | null
): void {
  const material = setup.surfaceMaterial;

  if (setup.isEyeMaterial) {
    return;
  }

  if (config.mtoonShadeEnabled) {
    material.shadeColorFactor
      .copy(setup.originalShadeColor)
      .lerp(new THREE.Color(0, 0, 0), clamp(config.shadeStrength, 0, 1) * 0.65);
    material.shadingShiftFactor = config.shadingShift;
    material.shadingToonyFactor = config.shadingToony;
  } else {
    material.shadeColorFactor.copy(setup.originalShadeColor);
    material.shadingShiftFactor = setup.originalShadingShift;
    material.shadingToonyFactor = setup.originalShadingToony;
  }

  material.rimLightingMixFactor = config.rimEnabled ? 0.45 : 1;
  material.parametricRimColorFactor
    .setRGB(1, 0.92, 0.78)
    .multiplyScalar(config.rimEnabled ? clamp(config.rimStrength, 0, 1) : 0);
  material.parametricRimFresnelPowerFactor = Math.max(0.1, config.rimFresnelPower);
  material.parametricRimLiftFactor = 0;

  if (setup.isHairMaterial && config.hairHighlightEnabled && hairHighlightTexture) {
    material.matcapTexture = hairHighlightTexture;
    material.matcapFactor.setRGB(1, 0.78, 0.62).multiplyScalar(clamp(config.hairHighlightStrength, 0, 1));
  } else {
    material.matcapTexture = setup.originalMatcapTexture;
    material.matcapFactor.copy(setup.originalMatcapFactor);
  }

  // The bundled AO mask is not authored for each model's UV layout. Applying
  // it to shared materials such as Serina's Head also darkens the eye texture.

  material.needsUpdate = true;
}

function applyOutlineConfig(material: MToonMaterialLike | undefined, config: CharacterRenderConfig): void {
  if (!material) {
    return;
  }

  material.outlineWidthMode = config.outlineEnabled ? 'worldCoordinates' : 'none';
  material.outlineWidthFactor = config.outlineEnabled ? Math.max(0, config.outlineWidth) : 0;
  material.outlineColorFactor.setScalar(1 - clamp(config.outlineDarkness, 0, 1));
  material.outlineLightingMixFactor = 0;
  material.needsUpdate = true;
}

function findOrCreateOutlineMaterial(
  mesh: THREE.Mesh,
  surfaceMaterial: MToonMaterialLike
): MToonMaterialLike | undefined {
  const existingOutline = getMaterialList(mesh.material).find(isMToonOutlineMaterial);
  if (existingOutline) {
    return existingOutline;
  }

  const outlineMaterial = surfaceMaterial.clone() as MToonMaterialLike;
  outlineMaterial.name = `${surfaceMaterial.name || 'MToon'} (Outline)`;
  outlineMaterial.isOutline = true;
  outlineMaterial.side = THREE.BackSide;

  if (Array.isArray(mesh.material)) {
    const outlineIndex = mesh.material.length;
    mesh.material.push(outlineMaterial);
    addOutlineGroup(mesh.geometry, outlineIndex);
  } else {
    mesh.material = [surfaceMaterial, outlineMaterial];
    ensureSurfaceAndOutlineGroups(mesh.geometry);
  }

  return outlineMaterial;
}

function ensureSurfaceAndOutlineGroups(geometry: THREE.BufferGeometry): void {
  if (geometry.groups.length === 0) {
    const vertexCount = getRenderableVertexCount(geometry);
    geometry.addGroup(0, vertexCount, 0);
    geometry.addGroup(0, vertexCount, 1);
    return;
  }

  addOutlineGroup(geometry, 1);
}

function addOutlineGroup(geometry: THREE.BufferGeometry, materialIndex: number): void {
  geometry.addGroup(0, getRenderableVertexCount(geometry), materialIndex);
}

function getRenderableVertexCount(geometry: THREE.BufferGeometry): number {
  return geometry.index?.count ?? geometry.attributes.position.count / 3;
}

function getMaterialList(material: THREE.Material | THREE.Material[]): THREE.Material[] {
  return Array.isArray(material) ? material : [material];
}

function isHairMaterial(object: THREE.Object3D, material: THREE.Material): boolean {
  const name = `${object.name} ${material.name}`.toLowerCase();
  return /hair|bang|fringe|ahoge|hane|髪|前髪|後髪|横髪|毛/.test(name);
}

function isEyeMaterial(object: THREE.Object3D, material: THREE.Material): boolean {
  const name = `${object.name} ${material.name}`.toLowerCase();
  return /eye|eyeball|iris|pupil|眼|瞳|虹膜/.test(name);
}

function isMToonSurfaceMaterial(material: THREE.Material): material is MToonMaterialLike {
  return isMToonMaterial(material) && material.isOutline !== true;
}

function isMToonOutlineMaterial(material: THREE.Material): material is MToonMaterialLike {
  return isMToonMaterial(material) && material.isOutline === true;
}

function isMToonMaterial(material: THREE.Material): material is MToonMaterialLike {
  const candidate = material as Partial<MToonMaterialLike>;

  return (
    candidate.isMToonMaterial === true &&
    candidate.shadeColorFactor instanceof THREE.Color &&
    typeof candidate.shadingShiftFactor === 'number' &&
    typeof candidate.shadingToonyFactor === 'number'
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
