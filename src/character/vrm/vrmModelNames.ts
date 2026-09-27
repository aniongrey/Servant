import { readStoredJson, writeStoredJson } from '../../app/settings/browserStorage';

/**
 * Display names the user gives to VRM models.
 *
 * Both kinds of models are named here rather than in their own store:
 *
 * - built-in models are scanned from disk (`vrmModels.ts`), so their label is a
 *   file name and cannot be changed at the source;
 * - imported models already carry a `name` in IndexedDB, but that field *is*
 *   their file name (`ImportedVrmStore`), and the desktop window matches its own
 *   cached copy by that name — so the alias lives here, next to the built-in
 *   ones, and the record stays untouched.
 *
 * One map for both keeps a single code path for rename/reset, and leaves
 * `name === 原文件名` true everywhere, which is what makes "恢复原名" possible.
 */
export const VRM_MODEL_NAMES_STORAGE_KEY = 'codex-list.vrmModelNames.v1';

export const VRM_MODEL_NAME_MAX_LENGTH = 40;

export type VrmModelNameOverrides = Record<string, string>;

/** Trims, collapses whitespace and caps the length. Empty means "no alias". */
export function normalizeVrmModelName(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, VRM_MODEL_NAME_MAX_LENGTH);
}

export function normalizeVrmModelNames(value: unknown): VrmModelNameOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const overrides: VrmModelNameOverrides = {};
  for (const [id, name] of Object.entries(value as Record<string, unknown>)) {
    const modelId = id.trim();
    if (!modelId || typeof name !== 'string') continue;
    const normalized = normalizeVrmModelName(name);
    if (normalized) overrides[modelId] = normalized;
  }
  return overrides;
}

export function loadVrmModelNames(): VrmModelNameOverrides {
  return normalizeVrmModelNames(readStoredJson(VRM_MODEL_NAMES_STORAGE_KEY));
}

export function saveVrmModelNames(overrides: VrmModelNameOverrides): void {
  writeStoredJson(VRM_MODEL_NAMES_STORAGE_KEY, overrides);
}

/** Alias for `id`; an empty `name` clears it (i.e. restores the file name). */
export function setVrmModelName(
  overrides: VrmModelNameOverrides,
  id: string,
  name: string
): VrmModelNameOverrides {
  const modelId = id.trim();
  if (!modelId) return overrides;
  const next = { ...overrides };
  const normalized = normalizeVrmModelName(name);
  if (normalized) next[modelId] = normalized;
  else delete next[modelId];
  return next;
}

export function resolveVrmModelName(overrides: VrmModelNameOverrides, id: string, fallback: string): string {
  return overrides[id] ?? fallback;
}
