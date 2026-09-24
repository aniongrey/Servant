import { readStoredJson, writeStoredJson } from '../../app/settings/browserStorage';
import { AVATAR_FIT_CONFIG_STORAGE_KEY } from '../../app/settings/storageKeys';
import characterConfig from '../vrm/assets/default-character.json';
import { normalizeAvatarFitConfig, type AvatarFitConfig } from './AvatarFitConfig';

/**
 * The shipped fit lives in `assets/default-character.json` (it belongs to the
 * bundled VRM, not to the generic IK ranges), so it doubles as the initial
 * parameters for Avatar Fit. `AvatarFitConfig.defaultAvatarFitConfig` stays the
 * neutral fallback used by hit testing and the domain tests.
 */
export function normalizeCharacterAvatarFit(value: unknown): AvatarFitConfig {
  const fallback = normalizeAvatarFitConfig(characterConfig.avatarFit as Partial<AvatarFitConfig>);
  const saved =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Partial<AvatarFitConfig>)
      : undefined;
  // The domain normalizer already fills every nested field from the character defaults.
  return normalizeAvatarFitConfig(saved, fallback);
}

export function loadAvatarFitConfig(): AvatarFitConfig {
  return normalizeCharacterAvatarFit(readStoredJson(AVATAR_FIT_CONFIG_STORAGE_KEY));
}

export function saveAvatarFitConfig(config: AvatarFitConfig): void {
  writeStoredJson(AVATAR_FIT_CONFIG_STORAGE_KEY, normalizeCharacterAvatarFit(config));
}
