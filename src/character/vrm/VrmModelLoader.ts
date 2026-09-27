import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { throwIfAborted } from '../../app/utils/delay';
import { loadMmdCharacter, MmdCharacter } from '../mmd/MmdCharacter';

export interface VrmModelLoaderOptions {
  optimizeMesh?: boolean;
}

export class VrmModelLoader {
  constructor(private readonly options: VrmModelLoaderOptions = {}) {}

  async load(url: string, signal?: AbortSignal): Promise<VRM> {
    throwIfAborted(signal);

    if (/\.(pmx|pmd)(?:[?#]|$)/i.test(url)) return loadMmdCharacter(resolveUrl(url), signal);

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

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
