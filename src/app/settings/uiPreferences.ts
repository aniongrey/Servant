import { readStoredJson, readStoredString } from './browserStorage';
import {
  GLOBAL_PROXY_ENABLED_STORAGE_KEY,
  GLOBAL_PROXY_URL_STORAGE_KEY,
  DEFAULT_GLOBAL_PROXY_URL,
  WEB_SEARCH_ENABLED_STORAGE_KEY,
  UI_PREFERENCES_STORAGE_KEY
} from './storageKeys';

export interface UiPreferences {
  theme: 'nocturne' | 'moonlight' | 'sakura';
  fontScale: number;
  /**
   * Mirror of the single OS login-startup entry. The OS entry is the source of
   * truth: `useDesktopAutoStart` reconciles it whenever the settings window
   * opens, so a stale executable path cannot survive a reinstall.
   */
  autoStart: boolean;
  interactionHints: boolean;
  proxyEnabled: boolean;
  proxyUrl: string;
  webSearchEnabled: boolean;
}

export function loadUiPreferences(): UiPreferences {
  // 初始参数 = 2026-09-23 定型的一套：深色夜金主题、主页 100% 字号、不开机启动、
  // 不显示交互提示、不开代理、默认开启联网搜索。
  const fallback: UiPreferences = {
    theme: 'nocturne',
    fontScale: 1,
    autoStart: false,
    interactionHints: false,
    proxyEnabled: readStoredString(GLOBAL_PROXY_ENABLED_STORAGE_KEY) === 'true',
    proxyUrl: readStoredString(GLOBAL_PROXY_URL_STORAGE_KEY) || DEFAULT_GLOBAL_PROXY_URL,
    webSearchEnabled: readStoredString(WEB_SEARCH_ENABLED_STORAGE_KEY) !== 'false'
  };
  const value = readStoredJson(UI_PREFERENCES_STORAGE_KEY);
  const saved =
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Partial<UiPreferences>) : {};

  return {
    theme: saved.theme === 'moonlight' || saved.theme === 'sakura' ? saved.theme : fallback.theme,
    fontScale:
      typeof saved.fontScale === 'number' && Number.isFinite(saved.fontScale)
        ? Math.min(1.3, Math.max(0.9, saved.fontScale))
        : fallback.fontScale,
    autoStart: typeof saved.autoStart === 'boolean' ? saved.autoStart : fallback.autoStart,
    interactionHints:
      typeof saved.interactionHints === 'boolean' ? saved.interactionHints : fallback.interactionHints,
    proxyEnabled: typeof saved.proxyEnabled === 'boolean' ? saved.proxyEnabled : fallback.proxyEnabled,
    proxyUrl: typeof saved.proxyUrl === 'string' ? saved.proxyUrl : fallback.proxyUrl,
    webSearchEnabled:
      typeof saved.webSearchEnabled === 'boolean' ? saved.webSearchEnabled : fallback.webSearchEnabled
  };
}
