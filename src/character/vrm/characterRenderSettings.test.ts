import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHARACTER_RENDER_CONFIG_STORAGE_KEY } from '../../app/settings/storageKeys';
import { defaultCharacterRenderConfig } from './CharacterRenderConfig';
import {
  loadCharacterRenderConfig,
  normalizeCharacterRenderConfig,
  saveCharacterRenderConfig
} from './characterRenderSettings';

afterEach(() => vi.unstubAllGlobals());

describe('character render settings', () => {
  it('fills defaults while keeping valid overrides and rejecting invalid renderer values', () => {
    const config = normalizeCharacterRenderConfig({
      outlineEnabled: false,
      mainLightIntensity: 1.8,
      outlineWidth: Number.NaN,
      rimStrength: Number.POSITIVE_INFINITY,
      shadingShift: '0.2',
      mtoonShadeEnabled: 'true',
      unknownSetting: 42
    });

    expect(config.outlineEnabled).toBe(false);
    expect(config.mainLightIntensity).toBe(1.8);
    expect(config.outlineWidth).toBe(defaultCharacterRenderConfig.outlineWidth);
    expect(config.rimStrength).toBe(defaultCharacterRenderConfig.rimStrength);
    expect(config.shadingShift).toBe(defaultCharacterRenderConfig.shadingShift);
    expect(config.mtoonShadeEnabled).toBe(defaultCharacterRenderConfig.mtoonShadeEnabled);
    expect(config).not.toHaveProperty('unknownSetting');
  });

  it.each([undefined, null, [], 'invalid', 0])('handles a non-object settings payload: %j', (value) => {
    expect(normalizeCharacterRenderConfig(value)).toEqual(defaultCharacterRenderConfig);
  });

  it('recovers from corrupt storage and persists a normalized setting for all consumers', () => {
    const values = new Map([[CHARACTER_RENDER_CONFIG_STORAGE_KEY, '{broken']]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    });
    expect(loadCharacterRenderConfig()).toEqual(defaultCharacterRenderConfig);

    const baselineIntensity = defaultCharacterRenderConfig.mainLightIntensity;
    saveCharacterRenderConfig({ ...defaultCharacterRenderConfig, mainLightIntensity: baselineIntensity + 1 });
    expect(loadCharacterRenderConfig().mainLightIntensity).toBe(baselineIntensity + 1);
    // Saving must not mutate the shared default object that every reader falls back to.
    expect(defaultCharacterRenderConfig.mainLightIntensity).toBe(baselineIntensity);
  });

  it('can load defaults when browser storage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadCharacterRenderConfig()).toEqual(defaultCharacterRenderConfig);
    expect(() => saveCharacterRenderConfig(defaultCharacterRenderConfig)).not.toThrow();
  });
});
