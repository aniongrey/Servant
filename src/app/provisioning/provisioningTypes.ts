/**
 * Shared provisioning contracts.
 *
 * This module is intentionally free of any browser (`window`, `localStorage`) or
 * Node (`fs`, `path`) runtime API so it can be imported by both the setup
 * wizard (browser bundle) and the provisioning backend module (Node sidecar)
 * without pulling either environment into the other's graph.
 */

export type FeatureId = 'companion' | 'voice' | 'stt' | 'memory';

/** Backend route prefix owned by `network/server/provisioningApi.ts`. */
export const PROVISIONING_API_PATH = '/api/provisioning';

/** Persisted setup state, written into the user data directory. */
export const PROVISIONING_STATE_FILE = 'provisioning-state.json';

/** Folder created beside the app when the user has not chosen a download directory. */
export const DEFAULT_DOWNLOAD_DIRECTORY = 'models';

/**
 * Resource ids referenced outside the manifest.
 *
 * The ASR runtime has to name the directory its model is downloaded into, so the
 * id cannot live only in the server-side manifest — renaming a resource there
 * must break the build, not silently point the worker at a missing file.
 */
export const STT_MODEL_RESOURCE_ID = 'sherpa-asr-model';
export const MEMORY_MODEL_RESOURCE_ID = 'memory-embedding-model';

/**
 * Download sources for model repositories.
 *
 * A repository is pulled whole (every file the site reports), so the only thing
 * the user chooses is *where from*: `modelscope` is the default because it is
 * reachable from mainland China without a proxy, with the HuggingFace mirror and
 * the official HuggingFace host as fallbacks. The server maps each id to its API
 * endpoints in `network/server/modelRepository.ts`.
 */
export type ModelSiteId = 'modelscope' | 'hf-mirror' | 'huggingface';

export interface ModelSiteOption {
  id: ModelSiteId;
  label: string;
  hint: string;
}

export const MODEL_SITE_OPTIONS: readonly ModelSiteOption[] = [
  { id: 'modelscope', label: 'ModelScope 魔搭', hint: '国内直连，速度最快（推荐）' },
  { id: 'hf-mirror', label: 'HuggingFace 镜像', hint: 'hf-mirror.com，国内备用源' },
  { id: 'huggingface', label: 'HuggingFace 官方', hint: 'huggingface.co，海外网络更快' }
];

/** Fallback chain used when the user has not expressed a preference. */
export const DEFAULT_MODEL_SITE_ORDER: readonly ModelSiteId[] = ['modelscope', 'hf-mirror', 'huggingface'];

const MODEL_SITE_IDS: readonly ModelSiteId[] = ['modelscope', 'hf-mirror', 'huggingface'];

export function isModelSiteId(value: unknown): value is ModelSiteId {
  return typeof value === 'string' && (MODEL_SITE_IDS as readonly string[]).includes(value);
}

/**
 * Coerces a stored value into a complete, de-duplicated site order.
 *
 * The result always lists every known site — valid stored ids first (preserving
 * the user's ordering), then the remaining defaults — so a stale or partial
 * preference can never leave a repository with nowhere to download from.
 */
export function normalizeModelSiteOrder(value: unknown): ModelSiteId[] {
  const stored = Array.isArray(value) ? value.filter(isModelSiteId) : [];
  const ordered: ModelSiteId[] = [];
  for (const id of [...stored, ...DEFAULT_MODEL_SITE_ORDER]) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}

export function modelSiteLabel(id: ModelSiteId): string {
  return MODEL_SITE_OPTIONS.find((option) => option.id === id)?.label ?? id;
}

/**
 * Path (without origin) of a file served out of a provisioned resource
 * directory. Both the ASR worker's asset URLs and the backend route are built
 * from this, so the two cannot drift.
 */
export function provisioningAssetPath(resourceId: string, filePath: string): string {
  const file = filePath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join('/');
  return `${PROVISIONING_API_PATH}/assets/${encodeURIComponent(resourceId)}/${file}`;
}

export interface ProvisioningFeatureSelection {
  companion: boolean;
  voice: boolean;
  stt: boolean;
  memory: boolean;
}

export interface ProvisioningState {
  /** Set once the wizard has finished at least once. Drives the first-run gate. */
  setupComplete: boolean;
  /**
   * Directory every downloaded model is written to, chosen by the user.
   *
   * An absolute path; empty means "not chosen yet", in which case the backend
   * uses {@link DEFAULT_DOWNLOAD_DIRECTORY} beside the app. Models are the bulk
   * of Servant's footprint, so where they land is a user decision rather than an
   * `%APPDATA%` accident.
   */
  downloadRoot: string;
  /** Which capabilities the user opted into. Derived from the downloaded set. */
  features: ProvisioningFeatureSelection;
  /**
   * Preferred download-source order for model repositories. The head of the
   * list is what the wizard shows as selected; the remainder is the automatic
   * fallback chain used when a site is unreachable.
   */
  modelSites: ModelSiteId[];
  /** Resource ids the backend has prepared (downloaded and marked complete). */
  preparedResources: string[];
  /** ISO timestamp of the last write. */
  updatedAt?: string;
}

export function createDefaultProvisioningState(): ProvisioningState {
  return {
    setupComplete: false,
    downloadRoot: '',
    features: {
      companion: true,
      voice: true,
      stt: false,
      memory: true
    },
    modelSites: [...DEFAULT_MODEL_SITE_ORDER],
    preparedResources: []
  };
}

/** Coerces untrusted parsed JSON into a valid {@link ProvisioningState}. */
export function normalizeProvisioningState(value: unknown): ProvisioningState {
  const base = createDefaultProvisioningState();
  if (typeof value !== 'object' || value === null) return base;
  const raw = value as Record<string, unknown>;

  const features = (typeof raw.features === 'object' && raw.features !== null
    ? raw.features
    : {}) as Record<string, unknown>;
  const prepared = Array.isArray(raw.preparedResources)
    ? raw.preparedResources.filter((id): id is string => typeof id === 'string')
    : [];

  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
  const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);

  return {
    setupComplete: bool(raw.setupComplete, false),
    downloadRoot: str(raw.downloadRoot, base.downloadRoot),
    features: {
      companion: bool(features.companion, base.features.companion),
      voice: bool(features.voice, base.features.voice),
      stt: bool(features.stt, base.features.stt),
      memory: bool(features.memory, base.features.memory)
    },
    modelSites: normalizeModelSiteOrder(raw.modelSites),
    preparedResources: prepared,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined
  };
}
