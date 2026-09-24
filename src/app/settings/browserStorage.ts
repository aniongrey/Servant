/** Parsing is shared; each settings module validates its own data. */
export function readStoredString(key: string): string | undefined {
  try {
    return globalThis.localStorage?.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function readStoredJson(key: string): unknown {
  try {
    const raw = readStoredString(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

export function writeStoredJson(key: string, value: unknown): void {
  globalThis.localStorage?.setItem(key, JSON.stringify(value));
}
