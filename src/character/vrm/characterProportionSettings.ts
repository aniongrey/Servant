import { readStoredJson, writeStoredJson } from '../../app/settings/browserStorage';
import { CHARACTER_PROPORTION_CONFIG_STORAGE_KEY } from '../../app/settings/storageKeys';
import { normalizeCharacterProportionConfig, type CharacterProportionConfig } from './CharacterProportion';

export function loadCharacterProportionConfig(): CharacterProportionConfig {
  return normalizeCharacterProportionConfig(readStoredJson(CHARACTER_PROPORTION_CONFIG_STORAGE_KEY));
}

export function saveCharacterProportionConfig(config: CharacterProportionConfig): void {
  writeStoredJson(CHARACTER_PROPORTION_CONFIG_STORAGE_KEY, normalizeCharacterProportionConfig(config));
}
