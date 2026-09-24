import { useMemo } from 'react';
import { UI_PREFERENCES_STORAGE_KEY } from './storageKeys';
import { useStorageRevision } from './useStorageRevision';
import { loadUiPreferences, type UiPreferences } from './uiPreferences';

/**
 * Which `storage` writes must wake the pet window up. `null` is the key of a
 * `localStorage.clear()`, which always counts.
 */
export function isUiPreferencesStorageKey(key: string | null): boolean {
  return key === null || key === UI_PREFERENCES_STORAGE_KEY;
}

/**
 * Reads the shared UI preferences and re-reads them when another window saves.
 *
 * The pet window has no settings UI of its own, so this is how a toggle flipped
 * in the settings window reaches it.
 */
export function useUiPreferences(): UiPreferences {
  const revision = useStorageRevision(isUiPreferencesStorageKey);
  return useMemo(loadUiPreferences, [revision]);
}
