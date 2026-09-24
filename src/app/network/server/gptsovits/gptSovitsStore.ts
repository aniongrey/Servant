import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_GPT_SOVITS_SETTINGS,
  GPT_SOVITS_EMOTIONS,
  GPT_SOVITS_STUDIO_FILE,
  type GptSovitsLoadedWeights,
  type GptSovitsProfile,
  type GptSovitsSynthesisSettings
} from '../../gptSovitsContract.ts';

/**
 * Role presets for GPT-SoVITS, persisted as `studio.json` next to the uploaded
 * reference audio.
 *
 * Ported from the `gpt-sovtest` prototype. Loads lazily (the backend mounts
 * every API module at startup, and this one is idle until somebody opens the
 * voice settings) and writes through a temp file + rename so an interrupted
 * write cannot truncate the only copy of the presets.
 */

const SCHEMA_VERSION = 1;

export class GptSovitsStoreError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'GptSovitsStoreError';
    this.status = status;
  }
}

export interface GptSovitsStoreOptions {
  /** Writable directory: holds `studio.json` and `references/`. */
  dataDir: string;
  /** Pre-filled install root, used only until the user sets one. */
  defaultRoot?: string;
}

export interface GptSovitsStore {
  readonly referencesDir: string;
  /** Loads once; every read/write path awaits it. */
  ready(): Promise<void>;
  getRoot(): string;
  setRoot(root: string): Promise<string>;
  listProfiles(): GptSovitsProfile[];
  getProfile(id: string): GptSovitsProfile | null;
  upsertProfile(input: unknown): Promise<GptSovitsProfile>;
  importProfile(input: unknown): Promise<GptSovitsProfile>;
  deleteProfile(id: string): Promise<void>;
  getLoaded(): GptSovitsLoadedWeights;
  setLoaded(gpt: string, sovits: string): Promise<GptSovitsLoadedWeights>;
}

interface StudioState {
  schemaVersion: number;
  root: string;
  profiles: GptSovitsProfile[];
  loaded: GptSovitsLoadedWeights;
}

function emptyState(): StudioState {
  return { schemaVersion: SCHEMA_VERSION, root: '', profiles: [], loaded: { gpt: '', sovits: '' } };
}

export function createGptSovitsId(name?: string): string {
  const base =
    String(name ?? '')
      .trim()
      .toLowerCase()
      .replace(/[\\/:*?"<>|\s]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'role';
  return `${base}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function normalizeGptSovitsProfile(raw: unknown): GptSovitsProfile {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const settingsSource = (
    source.settings && typeof source.settings === 'object' ? source.settings : {}
  ) as Partial<GptSovitsSynthesisSettings>;
  const modelsSource = (source.models && typeof source.models === 'object' ? source.models : {}) as {
    gpt?: unknown;
    sovits?: unknown;
  };
  const referencesSource = (
    source.references && typeof source.references === 'object' ? source.references : {}
  ) as Record<string, unknown>;

  const settings = { ...DEFAULT_GPT_SOVITS_SETTINGS, ...settingsSource } as GptSovitsSynthesisSettings;
  const references: GptSovitsProfile['references'] = {};
  for (const emotion of GPT_SOVITS_EMOTIONS) {
    const entry = referencesSource[emotion];
    if (!entry || typeof entry !== 'object') continue;
    const value = entry as { audio?: unknown; text?: unknown; lang?: unknown };
    references[emotion] = {
      audio: typeof value.audio === 'string' ? value.audio : '',
      text: typeof value.text === 'string' ? value.text : '',
      lang: typeof value.lang === 'string' && value.lang ? value.lang : 'zh'
    };
  }

  return {
    id: typeof source.id === 'string' && source.id ? source.id : createGptSovitsId(nameOf(source)),
    name: typeof source.name === 'string' && source.name ? source.name : '未命名角色',
    models: {
      gpt: typeof modelsSource.gpt === 'string' ? modelsSource.gpt : '',
      sovits: typeof modelsSource.sovits === 'string' ? modelsSource.sovits : ''
    },
    text_lang: typeof source.text_lang === 'string' && source.text_lang ? source.text_lang : 'zh',
    references,
    settings
  };
}

function nameOf(source: Record<string, unknown>): string | undefined {
  return typeof source.name === 'string' ? source.name : undefined;
}

export function createGptSovitsStore(options: GptSovitsStoreOptions): GptSovitsStore {
  const file = path.join(options.dataDir, GPT_SOVITS_STUDIO_FILE);
  const referencesDir = path.join(options.dataDir, 'references');
  let state: StudioState | null = null;
  let loading: Promise<void> | null = null;

  const persist = async (): Promise<void> => {
    const current = state ?? emptyState();
    await mkdir(options.dataDir, { recursive: true });
    const temp = `${file}.tmp`;
    await writeFile(temp, JSON.stringify(current, null, 2), 'utf8');
    await rename(temp, file);
  };

  const load = async (): Promise<void> => {
    mkdirSync(referencesDir, { recursive: true });
    const next = emptyState();
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      next.schemaVersion = Number(parsed.schemaVersion) || SCHEMA_VERSION;
      next.root = typeof parsed.root === 'string' ? parsed.root : '';
      const loaded = (parsed.loaded ?? {}) as { gpt?: unknown; sovits?: unknown };
      next.loaded = {
        gpt: typeof loaded.gpt === 'string' ? loaded.gpt : '',
        sovits: typeof loaded.sovits === 'string' ? loaded.sovits : ''
      };
      if (Array.isArray(parsed.profiles)) next.profiles = parsed.profiles.map(normalizeGptSovitsProfile);
    } catch {
      // Missing or corrupt file: start from the empty state and rewrite it below.
    }
    if (!next.root && options.defaultRoot && existsSync(options.defaultRoot)) {
      next.root = options.defaultRoot;
    }
    if (next.profiles.length === 0) {
      next.profiles = [normalizeGptSovitsProfile({ name: '默认角色' })];
    }
    const seen = new Set<string>();
    for (const profile of next.profiles) {
      if (seen.has(profile.id)) profile.id = createGptSovitsId(profile.name);
      seen.add(profile.id);
    }
    state = next;
    await persist();
  };

  const ready = (): Promise<void> => {
    loading ??= load().catch((error) => {
      loading = null;
      throw error;
    });
    return loading;
  };

  const requireState = (): StudioState => {
    if (!state) throw new GptSovitsStoreError('角色配置尚未加载', 503);
    return state;
  };

  return {
    referencesDir,
    ready,
    getRoot: () => requireState().root,
    async setRoot(root) {
      requireState().root = root;
      await persist();
      return root;
    },
    listProfiles: () => requireState().profiles,
    getProfile(id) {
      return requireState().profiles.find((profile) => profile.id === id) ?? null;
    },
    async upsertProfile(input) {
      const current = requireState();
      const normalized = normalizeGptSovitsProfile(input);
      const index = current.profiles.findIndex((profile) => profile.id === normalized.id);
      if (index >= 0) current.profiles[index] = normalized;
      else current.profiles.push(normalized);
      await persist();
      return normalized;
    },
    async importProfile(input) {
      const current = requireState();
      const normalized = normalizeGptSovitsProfile(input);
      // Importing always mints a new id, so a shared preset can never overwrite one.
      normalized.id = createGptSovitsId(normalized.name);
      const base = normalized.name;
      let suffix = 2;
      while (current.profiles.some((profile) => profile.name === normalized.name)) {
        normalized.name = `${base} (${suffix++})`;
      }
      current.profiles.push(normalized);
      await persist();
      return normalized;
    },
    async deleteProfile(id) {
      const current = requireState();
      if (current.profiles.length <= 1) {
        throw new GptSovitsStoreError('至少保留一个角色，最后一个角色不可删除');
      }
      const index = current.profiles.findIndex((profile) => profile.id === id);
      if (index < 0) throw new GptSovitsStoreError('角色不存在', 404);
      current.profiles.splice(index, 1);
      await persist();
    },
    getLoaded: () => ({ ...requireState().loaded }),
    async setLoaded(gpt, sovits) {
      const current = requireState();
      if (typeof gpt === 'string') current.loaded.gpt = gpt;
      if (typeof sovits === 'string') current.loaded.sovits = sovits;
      await persist();
      return { ...current.loaded };
    }
  };
}
