import { afterEach, describe, expect, it, vi } from 'vitest';
import { AVATAR_FIT_CONFIG_STORAGE_KEY } from '../../app/settings/storageKeys';
import { loadAvatarFitConfig, normalizeCharacterAvatarFit, saveAvatarFitConfig } from './avatarFitSettings';

afterEach(() => vi.unstubAllGlobals());

describe('character avatar fit settings', () => {
  it('merges partial nested overrides with the character defaults', () => {
    const fallback = normalizeCharacterAvatarFit(undefined);
    const config = normalizeCharacterAvatarFit({
      wristRotationOffset: { x: 0.15 },
      colliders: { head: { radius: 0.22 } },
      handIk: { strength: 0.7 }
    });

    expect(config.wristRotationOffset).toEqual({ ...fallback.wristRotationOffset, x: 0.15 });
    expect(config.colliders.head).toEqual({ ...fallback.colliders.head, radius: 0.22 });
    expect(config.colliders.torso).toEqual(fallback.colliders.torso);
    expect(config.handIk).toEqual({ ...fallback.handIk, strength: 0.7 });
  });

  it('rejects wrong types at nested boundaries without losing valid fields', () => {
    const fallback = normalizeCharacterAvatarFit(undefined);
    const config = normalizeCharacterAvatarFit({
      showGuide: 'true',
      height: Infinity,
      colliders: null,
      wristRotationOffset: [],
      handIk: { enabled: false, strength: '0.7', torsoPushMode: 'unknown' }
    });

    expect(config.height).toBe(fallback.height);
    expect(config.showGuide).toBe(fallback.showGuide);
    expect(config.colliders).toEqual(fallback.colliders);
    expect(config.handIk).toEqual({ ...fallback.handIk, enabled: false });
  });

  it('round trips settings without sharing mutable nested defaults', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    });
    const config = loadAvatarFitConfig();
    config.colliders.head.radius = 0.2;
    expect(loadAvatarFitConfig().colliders.head.radius).not.toBe(0.2);
    saveAvatarFitConfig(config);
    expect(JSON.parse(values.get(AVATAR_FIT_CONFIG_STORAGE_KEY)!).colliders.head.radius).toBe(0.2);
    expect(loadAvatarFitConfig().colliders.head.radius).toBe(0.2);
  });
});
