import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UI_PREFERENCES_STORAGE_KEY,
  GLOBAL_PROXY_ENABLED_STORAGE_KEY,
  GLOBAL_PROXY_URL_STORAGE_KEY,
  WEB_SEARCH_ENABLED_STORAGE_KEY
} from './storageKeys';
import { loadUiPreferences } from './uiPreferences';

afterEach(() => vi.unstubAllGlobals());

function mockPreferences(value: unknown) {
  const values = new Map([
    [UI_PREFERENCES_STORAGE_KEY, JSON.stringify(value)],
    [GLOBAL_PROXY_ENABLED_STORAGE_KEY, 'true'],
    [GLOBAL_PROXY_URL_STORAGE_KEY, 'http://localhost:1234']
  ]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null });
}

describe('UI preferences', () => {
  it('restores every known theme and only falls back for unknown ones', () => {
    mockPreferences({ theme: 'sakura' });
    expect(loadUiPreferences().theme).toBe('sakura');
    // 夜金 used to be dropped on load even though it is a real theme; a stored
    // value must survive the default moving to 樱梦.
    mockPreferences({ theme: 'nocturne' });
    expect(loadUiPreferences().theme).toBe('nocturne');
    mockPreferences({ theme: 'unknown' });
    expect(loadUiPreferences().theme).toBe('sakura');
  });
  it.each([null, [], 1, 'wrong'])('uses defaults for invalid settings payloads: %j', (value) => {
    mockPreferences(value);
    expect(loadUiPreferences()).toMatchObject({
      theme: 'sakura',
      fontScale: 1,
      autoStart: false,
      interactionHints: true,
      proxyEnabled: true,
      proxyUrl: 'http://localhost:1234'
    });
  });

  it('keeps valid flags, clamps font size, and rejects wrongly typed values', () => {
    mockPreferences({
      theme: 'moonlight',
      fontScale: 10,
      autoStart: true,
      interactionHints: 'false',
      proxyUrl: 1
    });
    expect(loadUiPreferences()).toMatchObject({
      theme: 'moonlight',
      fontScale: 1.3,
      autoStart: true,
      interactionHints: true,
      proxyUrl: 'http://localhost:1234'
    });
  });

  it('defaults web search on unless the legacy flag is explicitly false', () => {
    mockPreferences({ theme: 'nocturne' });
    expect(loadUiPreferences().webSearchEnabled).toBe(true);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === WEB_SEARCH_ENABLED_STORAGE_KEY ? 'false' : null)
    });
    expect(loadUiPreferences().webSearchEnabled).toBe(false);
  });

  it('drops retired keys such as minimizeToTray', () => {
    mockPreferences({ autoStart: true, minimizeToTray: false });
    const preferences = loadUiPreferences();
    expect(preferences.autoStart).toBe(true);
    expect('minimizeToTray' in preferences).toBe(false);
  });
});
