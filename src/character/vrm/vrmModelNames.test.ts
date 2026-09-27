import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VRM_MODEL_NAME_MAX_LENGTH,
  VRM_MODEL_NAMES_STORAGE_KEY,
  loadVrmModelNames,
  normalizeVrmModelName,
  normalizeVrmModelNames,
  resolveVrmModelName,
  saveVrmModelNames,
  setVrmModelName
} from './vrmModelNames';

describe('vrmModelNames', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() {
        return values.size;
      }
    } satisfies Storage);
  });

  it('normalizes names and refuses empty aliases', () => {
    expect(normalizeVrmModelName('  白   瓜  ')).toBe('白 瓜');
    expect(normalizeVrmModelName('x'.repeat(VRM_MODEL_NAME_MAX_LENGTH + 20))).toHaveLength(
      VRM_MODEL_NAME_MAX_LENGTH
    );
    expect(normalizeVrmModelName('   ')).toBe('');
  });

  it('keeps only usable entries from stored data', () => {
    expect(normalizeVrmModelNames(null)).toEqual({});
    expect(normalizeVrmModelNames(['nope'])).toEqual({});
    expect(
      normalizeVrmModelNames({ main: '  白瓜  ', blank: '   ', '  ': 'x', bad: 42, other: '可莉' })
    ).toEqual({ main: '白瓜', other: '可莉' });
  });

  it('sets and clears a single alias without touching the others', () => {
    const first = setVrmModelName({}, 'main', '白瓜');
    expect(first).toEqual({ main: '白瓜' });
    expect(setVrmModelName(first, 'keli', '可莉')).toEqual({ main: '白瓜', keli: '可莉' });
    expect(setVrmModelName(first, 'main', '   ')).toEqual({});
    // An unusable id is ignored rather than silently written under an empty key.
    expect(setVrmModelName(first, '  ', 'x')).toEqual({ main: '白瓜' });
  });

  it('falls back to the scanned label when a model has no alias', () => {
    expect(resolveVrmModelName({ main: '白瓜' }, 'main', 'TestModel')).toBe('白瓜');
    expect(resolveVrmModelName({ main: '白瓜' }, 'other', '可莉')).toBe('可莉');
  });

  it('round-trips through local storage and tolerates a broken payload', () => {
    saveVrmModelNames({ main: '白瓜' });
    expect(JSON.parse(localStorage.getItem(VRM_MODEL_NAMES_STORAGE_KEY) ?? '{}')).toEqual({ main: '白瓜' });
    expect(loadVrmModelNames()).toEqual({ main: '白瓜' });

    localStorage.setItem(VRM_MODEL_NAMES_STORAGE_KEY, '{not json');
    expect(loadVrmModelNames()).toEqual({});
  });
});
