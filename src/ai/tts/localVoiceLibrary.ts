import { readStoredJson, writeStoredJson } from '../../app/settings/browserStorage';
import {
  getSpeechSdkProviderOption,
  getTtsProviderKind,
  isSpeechSdkProviderId
} from './speechSdkProviderOptions';
import type { SpeechSdkProviderId, SpeechSdkTtsProviderConfig } from './speechSdkTypes';

/**
 * Named voices the user saves per provider.
 *
 * The runtime configuration only ever holds *one* voice per provider
 * (`SpeechSdkTtsProviderConfig.voice`), which is fine until the same account has
 * several usable ones and the user has to retype a Voice ID to switch back. The
 * library is the list of the ones worth keeping: a name to recognise them by,
 * plus the model and Voice ID needed to re-apply one to the draft config.
 *
 * It is **per provider** because a Voice ID only means something inside the
 * provider that issued it — the settings page therefore shows the entries of
 * the currently selected provider and nothing else. Storage is local: the same
 * keys the rest of the voice settings already use, no backend round trip.
 *
 * Two kinds of `voice` are stored, and the difference is who owns the thing the
 * id points at:
 *
 * - **remote providers** (`openai`, `doubao`, …) — the id names a voice inside
 *   the account, and the settings page is the only place it is ever typed;
 * - **GPT-SoVITS** — the id names a role preset that lives in the backend
 *   (`studio.json`, edited on the studio page), so an entry here is a *pointer*:
 *   the library automatically keeps one pointer per saved role, preserving
 *   existing aliases and removing pointers whose role has been deleted. Role
 *   weights and references remain owned by the backend.
 */
export const TTS_VOICE_LIBRARY_STORAGE_KEY = 'codex-list.ttsVoiceLibrary.v1';

export const VOICE_NAME_MAX_LENGTH = 40;

export interface LocalVoiceEntry {
  id: string;
  provider: SpeechSdkProviderId;
  /** User-facing name; never empty (falls back to `提供商 · 音色`). */
  name: string;
  model: string;
  voice: string;
  createdAt: number;
  updatedAt: number;
}

export interface LocalVoiceInput {
  /** Set to update an existing entry; omitted to add a new one. */
  id?: string;
  provider: SpeechSdkProviderId;
  name: string;
  model: string;
  voice: string;
}

export function normalizeVoiceName(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, VOICE_NAME_MAX_LENGTH);
}

/**
 * A voice whose id is issued by someone else, passed in by the view that knows
 * the list.
 *
 * Today this is exactly the GPT-SoVITS role presets: their names, weights and
 * reference audio are owned by the backend and edited on the studio page, so the
 * voice library never stores them — it stores the user's pick and resolves the
 * name here.
 */
export interface ExternalVoicePreset {
  id: string;
  name: string;
}

/** The preset a saved id points at, or `undefined` once it is gone. */
export function findVoicePreset(
  presets: readonly ExternalVoicePreset[] | undefined,
  voice: string
): ExternalVoicePreset | undefined {
  const id = voice.trim();
  if (!id || !presets) return undefined;
  return presets.find((preset) => preset.id === id);
}

/**
 * Label of a *saved* voice for the list rows.
 *
 * Passing `presets` (even an empty list) marks the provider as one whose voices
 * are owned elsewhere, and an id no preset answers to is then reported as such
 * instead of being printed as a raw id — "the role is gone / not loaded yet" is
 * the useful fact there, whereas a remote Voice ID is meaningful on its own.
 */
export function describeSavedVoice(
  entry: Pick<LocalVoiceEntry, 'provider' | 'voice'>,
  presets?: readonly ExternalVoicePreset[]
): string {
  const preset = findVoicePreset(presets, entry.voice);
  if (preset) return preset.name;
  return presets ? `${entry.voice.trim()}（角色未找到）` : describeVoiceLabel(entry.provider, entry.voice);
}

/** Label of a preset voice, or the raw id when the provider has none for it. */
export function describeVoiceLabel(provider: SpeechSdkProviderId, voice: string): string {
  const trimmed = voice.trim();
  const preset = getSpeechSdkProviderOption(provider).voices.find((option) => option.id === trimmed);
  return preset?.label ?? trimmed;
}

/**
 * Default name for a saved entry: the external preset's own name, otherwise the
 * provider, then the voice it points at.
 */
export function suggestVoiceName(
  provider: SpeechSdkProviderId,
  voice: string,
  presets?: readonly ExternalVoicePreset[]
): string {
  const preset = findVoicePreset(presets, voice);
  // A role preset already *is* the name; prefixing it would only add noise.
  if (preset && normalizeVoiceName(preset.name)) return normalizeVoiceName(preset.name);
  const label = describeVoiceLabel(provider, voice);
  const providerLabel = getSpeechSdkProviderOption(provider).label;
  return label && label !== providerLabel ? `${providerLabel} · ${label}` : providerLabel;
}

export function createVoiceEntryId(now = Date.now()): string {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10);
  return `voice-${now}-${suffix}`;
}

function normalizeTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/**
 * Accepts the stored shape and returns `null` for anything unusable. An entry
 * without an id gets a deterministic one, so a hand-edited file still loads and
 * two identical rows collapse instead of duplicating.
 */
export function normalizeLocalVoiceEntry(value: unknown): LocalVoiceEntry | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<Record<keyof LocalVoiceEntry, unknown>>;
  if (!isSpeechSdkProviderId(record.provider)) return null;
  const provider = record.provider;
  const voice = typeof record.voice === 'string' ? record.voice.trim() : '';
  if (!voice) return null;
  const option = getSpeechSdkProviderOption(provider);
  const model =
    typeof record.model === 'string' && record.model.trim() ? record.model.trim() : option.defaultModel;
  const id =
    typeof record.id === 'string' && record.id.trim()
      ? record.id.trim()
      : `voice-${provider}-${model}-${voice}`;
  const createdAt = normalizeTimestamp(record.createdAt);
  const updatedAt = normalizeTimestamp(record.updatedAt) || createdAt;
  const name = typeof record.name === 'string' ? normalizeVoiceName(record.name) : '';
  return {
    id,
    provider,
    name: name || suggestVoiceName(provider, voice),
    model,
    voice,
    createdAt,
    updatedAt
  };
}

export function normalizeVoiceLibrary(value: unknown): LocalVoiceEntry[] {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { voices?: unknown }).voices)
    ? (value as { voices: unknown[] }).voices
    : [];
  const byId = new Map<string, LocalVoiceEntry>();
  for (const raw of list) {
    const entry = normalizeLocalVoiceEntry(raw);
    if (entry) byId.set(entry.id, entry);
  }
  return sortVoiceEntries([...byId.values()]);
}

export function loadVoiceLibrary(): LocalVoiceEntry[] {
  return normalizeVoiceLibrary(readStoredJson(TTS_VOICE_LIBRARY_STORAGE_KEY));
}

export function saveVoiceLibrary(entries: readonly LocalVoiceEntry[]): void {
  writeStoredJson(TTS_VOICE_LIBRARY_STORAGE_KEY, entries);
}

/** Keep GPT-SoVITS pointers in step with the backend's saved roles. */
export function reconcileGptSovitsVoices(
  entries: readonly LocalVoiceEntry[],
  roles: readonly ExternalVoicePreset[],
  now = Date.now()
): LocalVoiceEntry[] {
  const roleIds = new Set(roles.map((role) => role.id));
  const seen = new Set<string>();
  const next = entries.filter((entry) => {
    if (entry.provider !== 'gpt-sovits') return true;
    if (!roleIds.has(entry.voice) || seen.has(entry.voice)) return false;
    seen.add(entry.voice);
    return true;
  }).map((entry) => entry.provider === 'gpt-sovits' && entry.model !== 'api_v2'
    ? { ...entry, model: 'api_v2', updatedAt: now } : entry);
  for (const role of roles) {
    if (seen.has(role.id)) continue;
    next.push({
      id: createVoiceEntryId(now), provider: 'gpt-sovits',
      name: normalizeVoiceName(role.name) || suggestVoiceName('gpt-sovits', role.id),
      model: 'api_v2', voice: role.id, createdAt: now, updatedAt: now
    });
  }
  return sortVoiceEntries(next);
}

export function syncGptSovitsVoices(roles: readonly ExternalVoicePreset[]): LocalVoiceEntry[] {
  const current = loadVoiceLibrary();
  const next = reconcileGptSovitsVoices(current, roles);
  if (JSON.stringify(next) !== JSON.stringify(current)) saveVoiceLibrary(next);
  return next;
}

/** Newest first; equal timestamps fall back to the name for a stable order. */
export function sortVoiceEntries(entries: readonly LocalVoiceEntry[]): LocalVoiceEntry[] {
  return [...entries].sort(
    (left, right) => right.createdAt - left.createdAt || left.name.localeCompare(right.name, 'zh')
  );
}

/**
 * The saved voices of one provider, newest first.
 *
 * Pass `model` to narrow it further to the model the settings page is currently
 * on: a Voice ID is not guaranteed to work across a provider's models, so the
 * page shows the model's own voices and nothing else. An empty model means "no
 * model filter", which is also what callers that only group by provider get.
 */
export function listProviderVoices(
  entries: readonly LocalVoiceEntry[],
  provider: SpeechSdkProviderId,
  model?: string
): LocalVoiceEntry[] {
  const scopedModel = model?.trim();
  return sortVoiceEntries(
    entries.filter((entry) => entry.provider === provider && (!scopedModel || entry.model === scopedModel))
  );
}

/** Matches the name, the raw ids, and the label behind a Voice ID. */
export function filterVoiceEntries(
  entries: readonly LocalVoiceEntry[],
  query: string,
  presets?: readonly ExternalVoicePreset[]
): LocalVoiceEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...entries];
  return entries.filter((entry) =>
    [entry.name, entry.model, entry.voice, describeSavedVoice(entry, presets)].some((text) =>
      text.toLowerCase().includes(needle)
    )
  );
}

export function upsertVoiceEntry(
  entries: readonly LocalVoiceEntry[],
  input: LocalVoiceInput,
  now = Date.now()
): LocalVoiceEntry[] {
  const voice = input.voice.trim();
  const existing = input.id ? entries.find((entry) => entry.id === input.id) : undefined;
  if (!voice) return existing ? deleteVoiceEntry(entries, existing.id) : [...entries];
  const option = getSpeechSdkProviderOption(input.provider);
  const model = input.model.trim() || option.defaultModel;
  const entry: LocalVoiceEntry = {
    id: existing?.id ?? input.id?.trim() ?? createVoiceEntryId(now),
    provider: input.provider,
    name: normalizeVoiceName(input.name) || suggestVoiceName(input.provider, voice),
    model,
    voice,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  return sortVoiceEntries([...entries.filter((item) => item.id !== entry.id), entry]);
}

export function deleteVoiceEntry(entries: readonly LocalVoiceEntry[], id: string): LocalVoiceEntry[] {
  return entries.filter((entry) => entry.id !== id);
}

/**
 * The saved entry the runtime config currently points at, if any.
 *
 * Derived instead of stored: the config is the single source of truth for
 * "which voice is in use", so a selection that disagrees with it cannot exist.
 */
export function findActiveVoiceEntry(
  entries: readonly LocalVoiceEntry[],
  config: Pick<SpeechSdkTtsProviderConfig, 'provider' | 'model' | 'voice'>
): LocalVoiceEntry | undefined {
  const voice = config.voice.trim();
  if (!voice) return undefined;
  return entries.find(
    (entry) =>
      entry.provider === config.provider && entry.voice === voice && entry.model === config.model.trim()
  );
}

/**
 * Whether a provider's voices are worth saving by name.
 *
 * Everything that picks a voice in the settings page does: the remote providers
 * type a Voice ID there, and GPT-SoVITS picks a role preset — in both cases the
 * library turns "the one I want back later" into a named row. `none` and the
 * local Microsoft engine have no voice field at all, so they have nothing to
 * save.
 *
 * Note this is about the *page*, not about who owns the voice: a GPT-SoVITS role
 * cannot be created from the library, only referenced by one.
 */
export function isVoiceLibraryProvider(provider: SpeechSdkProviderId): boolean {
  const kind = getTtsProviderKind(provider);
  return kind === 'speech-sdk' || kind === 'gpt-sovits';
}
