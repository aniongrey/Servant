import { describe, expect, it } from 'vitest';
import { UI_PREFERENCES_STORAGE_KEY } from './storageKeys';
import { isUiPreferencesStorageKey } from './useUiPreferences';

describe('isUiPreferencesStorageKey', () => {
  it('wakes the pet window up for preference writes and for a full clear', () => {
    expect(isUiPreferencesStorageKey(UI_PREFERENCES_STORAGE_KEY)).toBe(true);
    expect(isUiPreferencesStorageKey(null)).toBe(true);
  });

  it('ignores writes from the other settings keys', () => {
    expect(isUiPreferencesStorageKey('codex-list.ttsConfig.v3')).toBe(false);
    expect(isUiPreferencesStorageKey('codex-list.characterRenderConfig.v1')).toBe(false);
  });
});
