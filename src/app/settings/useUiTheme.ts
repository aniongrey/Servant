import { useEffect, useState } from 'react';
import { loadUiPreferences, type UiPreferences } from './uiPreferences';
import { UI_PREFERENCES_STORAGE_KEY } from './storageKeys';

export const UI_THEME_CHANGED_EVENT = 'servant-ui-theme-changed';

/** Apply the saved palette to every renderer, including chat, pet and the tray menu. */
export function useUiTheme(): UiPreferences['theme'] {
  const [theme, setTheme] = useState<UiPreferences['theme']>(() => loadUiPreferences().theme);
  useEffect(() => {
    const apply = () => {
      const nextTheme = loadUiPreferences().theme;
      document.documentElement.dataset.companionTheme = nextTheme;
      setTheme(nextTheme);
    };
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === UI_PREFERENCES_STORAGE_KEY) apply();
    };
    apply();
    window.addEventListener('storage', onStorage);
    window.addEventListener(UI_THEME_CHANGED_EVENT, apply);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(UI_THEME_CHANGED_EVENT, apply);
    };
  }, []);
  return theme;
}
