import { readStoredJson, writeStoredJson } from '../../app/settings/browserStorage';
import { CHARACTER_RENDER_CONFIG_STORAGE_KEY } from '../../app/settings/storageKeys';
import { defaultCharacterRenderConfig, type CharacterRenderConfig } from './CharacterRenderConfig';

export type CharacterRenderNumberKey = {
  [Key in keyof CharacterRenderConfig]: CharacterRenderConfig[Key] extends number ? Key : never;
}[keyof CharacterRenderConfig];

export type CharacterRenderBooleanKey = {
  [Key in keyof CharacterRenderConfig]: CharacterRenderConfig[Key] extends boolean ? Key : never;
}[keyof CharacterRenderConfig];

export function normalizeCharacterRenderConfig(value: unknown): CharacterRenderConfig {
  const saved =
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

  // Only known fields with the right type enter the renderer. Defaults define the schema.
  return Object.fromEntries(
    Object.entries(defaultCharacterRenderConfig).map(([key, fallback]) => {
      const candidate = saved[key];
      const valid =
        typeof fallback === 'boolean'
          ? typeof candidate === 'boolean'
          : typeof candidate === 'number' && Number.isFinite(candidate);
      return [key, valid ? candidate : fallback];
    })
  ) as unknown as CharacterRenderConfig;
}

export function loadCharacterRenderConfig(): CharacterRenderConfig {
  return normalizeCharacterRenderConfig(readStoredJson(CHARACTER_RENDER_CONFIG_STORAGE_KEY));
}

export function saveCharacterRenderConfig(config: CharacterRenderConfig): void {
  writeStoredJson(CHARACTER_RENDER_CONFIG_STORAGE_KEY, normalizeCharacterRenderConfig(config));
}
