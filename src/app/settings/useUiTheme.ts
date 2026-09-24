import { useEffect } from 'react';
import { loadUiPreferences } from './uiPreferences';
import { UI_PREFERENCES_STORAGE_KEY } from './storageKeys';

export const UI_THEME_CHANGED_EVENT = 'shiro-ui-theme-changed';

/** Apply the saved palette to every renderer, including chat, pet and the tray menu. */
export function useUiTheme() {
  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.companionTheme = loadUiPreferences().theme;
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
}
