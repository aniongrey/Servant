import { expect, it } from 'vitest';
import { enableVrmSceneLighting } from './VrmModelLoader';

it('lets unlit VRM materials receive scene lights without losing authored surface properties', () => {
  const coco = {
    extensions: { KHR_materials_unlit: {}, KHR_texture_transform: {} },
    alphaMode: 'MASK',
    alphaCutoff: 0.4,
    doubleSided: true,
    pbrMetallicRoughness: { baseColorTexture: { index: 2 }, metallicFactor: 0, roughnessFactor: 0.9 }
  };
  const original = structuredClone(coco);
  const fallback = { extensions: { KHR_materials_unlit: {} } };
  const mtoon = { extensions: { VRMC_materials_mtoon: { shadingToonyFactor: 0.9 } } };
  const originalMtoon = structuredClone(mtoon);
  enableVrmSceneLighting([coco, fallback, mtoon]);
  expect(coco).toEqual(original);
  expect(fallback).toEqual({ extensions: { KHR_materials_unlit: {} } });
  enableVrmSceneLighting([coco, fallback, mtoon], true);
  expect(coco).toEqual({ ...original, extensions: { KHR_texture_transform: {} } });
  expect(fallback).toEqual({ extensions: {}, pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 } });
  expect(mtoon).toEqual(originalMtoon);
});
