import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { throwIfAborted } from '../../app/utils/delay';
import { loadMmdCharacter, MmdCharacter } from '../mmd/MmdCharacter';
import { readMmdModelSource } from '../mmd/mmdModelFolder';
import { resolveModelArchive } from './importedModelUrl';

export interface VrmModelLoaderOptions {
  optimizeMesh?: boolean;
  forceUnlitLighting?: boolean;
}

export function isMmdModelUrl(url: string): boolean {
  return /\.(pmx|pmd)(?:[?#]|$)/i.test(url) || resolveModelArchive(url) !== undefined;
}

export class VrmModelLoader {
  constructor(private readonly options: VrmModelLoaderOptions = {}) {}

  async load(url: string, signal?: AbortSignal): Promise<VRM> {
    throwIfAborted(signal);

    // An imported PMX folder gives no hint in its URL: the bytes are a container
    // of many files, and the textures inside it can only be found by name. The
    // registry is what connects the URL back to them.
    const archive = resolveModelArchive(url);
    if (archive) return loadMmdCharacter(await readMmdModelSource(archive), signal);

    if (/\.(pmx|pmd)(?:[?#]|$)/i.test(url)) return loadMmdCharacter(resolveUrl(url), signal);

    const loader = new GLTFLoader();
    loader.register((parser) => {
      const plugin = new VRMLoaderPlugin(parser);
      const beforeRoot = plugin.beforeRoot.bind(plugin);
      plugin.beforeRoot = async () => {
        await beforeRoot();
        // MToon has already removed its unlit fallback; opt in for the rest.
        enableVrmSceneLighting(parser.json.materials ?? [], this.options.forceUnlitLighting);
      };
      return plugin;
    });

    const gltf = await loader.loadAsync(resolveUrl(url));
    throwIfAborted(signal);

    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) {
      throw new Error(`No VRM payload found in ${url}`);
    }

    if (this.options.optimizeMesh !== false) {
      VRMUtils.removeUnnecessaryVertices(vrm.scene);
      VRMUtils.combineSkeletons(vrm.scene);
      VRMUtils.combineMorphs(vrm);
    }

    return vrm;
  }
}

export function enableVrmSceneLighting(materials: Array<{
  extensions?: Record<string, unknown>;
  pbrMetallicRoughness?: Record<string, unknown>;
}>, enabled = false): void {
  if (!enabled) return;
  for (const material of materials) {
    if (!material.extensions?.KHR_materials_unlit) continue;
    delete material.extensions.KHR_materials_unlit;
    material.pbrMetallicRoughness = {
      metallicFactor: 0,
      roughnessFactor: 1,
      ...material.pbrMetallicRoughness
    };
  }
}

export function disposeCharacterModel(model: VRM): void {
  if (model instanceof MmdCharacter) model.dispose();
  else VRMUtils.deepDispose(model.scene);
}

function resolveUrl(url: string): string {
  if (typeof globalThis.location === 'undefined') {
    return url;
  }

  return new URL(url, globalThis.location.href).href;
}
