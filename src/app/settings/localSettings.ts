import defaultSettingsJson from '../../../default-settings.json';

export interface LocalSettingsBundle {
  version: number;
  name?: string;
  description?: string;
  exportedAt?: string;
  localStorage: Record<string, string>;
}

const APP_STORAGE_PREFIXES = ['codex-list.', 'character-state:', 'character-drama-engine:'];

export const defaultLocalSettings = defaultSettingsJson as LocalSettingsBundle;

export function isAppStorageKey(key: string): boolean {
  return APP_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function captureLocalSettings(): LocalSettingsBundle {
  const entries: Record<string, string> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !isAppStorageKey(key)) continue;
    const value = localStorage.getItem(key);
    if (value !== null) entries[key] = value;
  }

  return {
    version: 1,
    name: 'AIRI local settings export',
    exportedAt: new Date().toISOString(),
    localStorage: entries
  };
}

export function applyLocalSettings(bundle: LocalSettingsBundle): void {
  validateSettingsBundle(bundle);
  clearAppLocalSettings();
  Object.entries(bundle.localStorage).forEach(([key, value]) => {
    if (isAppStorageKey(key)) localStorage.setItem(key, value);
  });
}

export function resetLocalSettings(): void {
  applyLocalSettings(defaultLocalSettings);
}

export function clearAppLocalSettings(): void {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key && isAppStorageKey(key)) keys.push(key);
  }
  keys.forEach((key) => localStorage.removeItem(key));
}

export function parseLocalSettings(text: string): LocalSettingsBundle {
  const parsed = JSON.parse(text) as unknown;
  validateSettingsBundle(parsed);
  return parsed;
}

export function downloadLocalSettings(bundle = captureLocalSettings()): void {
  const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'airi-local-settings.json';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function validateSettingsBundle(value: unknown): asserts value is LocalSettingsBundle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('设置文件必须是 JSON 对象。');
  }
  const bundle = value as Partial<LocalSettingsBundle>;
  if (
    bundle.version !== 1 ||
    !bundle.localStorage ||
    typeof bundle.localStorage !== 'object' ||
    Array.isArray(bundle.localStorage)
  ) {
    throw new Error('不支持的设置文件格式。');
  }
  for (const [key, entry] of Object.entries(bundle.localStorage)) {
    if (!isAppStorageKey(key) || typeof entry !== 'string') {
      throw new Error(`设置项 ${key} 无效。`);
    }
  }
}
