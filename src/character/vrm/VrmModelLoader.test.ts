import { expect, it } from 'vitest';
import { enableVrmSceneLighting, isMmdModelUrl } from './VrmModelLoader';
import { createImportedModelUrl } from './importedModelUrl';
import { MODEL_ARCHIVE_MIME } from './modelArchive';

it('recognizes MMD files and imported MMD folders so the VRM-only light toggle skips reloads', () => {
  expect(isMmdModelUrl('/assets/character/fish.pmx')).toBe(true);
  expect(isMmdModelUrl('/assets/character/fish.pmd?raw=1')).toBe(true);
  expect(isMmdModelUrl('/assets/character/model.vrm')).toBe(false);

  const archive = createImportedModelUrl(new Blob([], { type: MODEL_ARCHIVE_MIME }));
  try {
    expect(isMmdModelUrl(archive.url)).toBe(true);
  } finally {
    archive.dispose();
  }
});

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
