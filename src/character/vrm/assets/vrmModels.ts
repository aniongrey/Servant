import characterConfig from './default-character.json';
import { toServedAssetUrl } from '../../../app/utils/servedAssetUrl';

export interface VrmModelOption {
  id: string;
  label: string;
  url: string;
}

const rootVrmFiles = import.meta.glob('/public/assets/character/*.vrm', {
  eager: true,
  import: 'default',
  query: '?url'
}) as Record<string, string>;

const nestedVrmFiles = import.meta.glob('/public/assets/character/**/*.vrm', {
  eager: true,
  import: 'default',
  query: '?url'
}) as Record<string, string>;

const scannedVrmFiles = {
  ...rootVrmFiles,
  ...nestedVrmFiles
};

export const vrmModelOptions: VrmModelOption[] = Object.entries(scannedVrmFiles)
  .map(([path, url]) => {
    const name = path.replace(/^\/public\/assets\/character\//, '').replace(/\.vrm$/i, '');

    return {
      id: toModelId(name),
      label: name,
      url: toServedAssetUrl(url)
    } satisfies VrmModelOption;
  })
  .sort((left, right) => {
    if (isBundledCharacter(left.url)) {
      return -1;
    }

    if (isBundledCharacter(right.url)) {
      return 1;
    }

    return left.label.localeCompare(right.label);
  });

export function resolveVrmModelOption(modelId: string): VrmModelOption {
  return (
    vrmModelOptions.find((model) => model.id === modelId) ??
    vrmModelOptions.find((model) => isBundledCharacter(model.url)) ??
    vrmModelOptions[0] ?? {
      id: toModelId(characterConfig.id),
      label: characterConfig.id,
      url: toServedAssetUrl(characterConfig.vrmUrl)
    }
  );
}

/**
 * Re-exported so the VRM domain keeps owning its public surface; the
 * implementation is shared with every other bundled-asset domain.
 */
export { toServedAssetUrl } from '../../../app/utils/servedAssetUrl';

function isBundledCharacter(url: string): boolean {
  return url === toServedAssetUrl(characterConfig.vrmUrl);
}

export function toModelId(name: string): string {
  const id = name
    .trim()
    .replace(/\\/g, '/')
    .replace(/\.vrm$/i, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

  // Keep non-Latin filenames usable as stable select values.
  return id || name.trim().replace(/\\/g, '/').replace(/\.vrm$/i, '');
}
