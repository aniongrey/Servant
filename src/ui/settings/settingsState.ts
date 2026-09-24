import { CHARACTER_STATE_STORAGE_KEY } from '../../app/settings/storageKeys';

import characterState from '../../character/state/assets/data/shiro/state.json';
import { readStoredJson } from '../../app/settings/browserStorage';

export function humanize(value: string) {
  return value
    .replace(/__/g, ' · ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function translateEmotion(value: string) {
  return (
    ({ happy: '开心', anger: '生气', sad: '难过', embarrassed: '害羞' } as Record<string, string>)[value] ??
    value
  );
}

export function loadManagedCharacterState(): typeof characterState {
  const saved = readStoredJson(CHARACTER_STATE_STORAGE_KEY) as Partial<typeof characterState> | undefined;
  return {
    relationship: {
      affection: clampState(saved?.relationship?.affection, characterState.relationship.affection),
      trust: clampState(saved?.relationship?.trust, characterState.relationship.trust)
    },
    emotion: {
      happy: clampState(saved?.emotion?.happy, characterState.emotion.happy),
      anger: clampState(saved?.emotion?.anger, characterState.emotion.anger),
      sad: clampState(saved?.emotion?.sad, characterState.emotion.sad),
      embarrassed: clampState(saved?.emotion?.embarrassed, characterState.emotion.embarrassed)
    }
  };
}

/**
 * Reads a boolean toggle. `fallback` is the app's initial parameter for the key,
 * so a key that has never been written still starts from the shipped default.
 */
export function loadBooleanSetting(key: string, fallback = false): boolean {
  const stored = localStorage.getItem(key);
  if (stored === null) return fallback;
  return stored === 'true';
}

function clampState(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : fallback;
}

export function relationshipStage(value: number): string {
  if (value >= 80) return '深度羁绊';
  if (value >= 55) return '亲密陪伴';
  if (value >= 30) return '逐渐熟悉';
  return '羁绊建立';
}

export function formatNumber(value: number): string {
  return Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatFileSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}
