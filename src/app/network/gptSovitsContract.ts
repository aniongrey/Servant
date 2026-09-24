/**
 * Wire contract for the local GPT-SoVITS integration.
 *
 * It is imported by the backend (`server/gptsovits/*`) and the frontend (voice
 * settings, TTS provider, studio page), so it must stay dependency-free: no
 * `node:*`, no DOM, no `backendFetch`. Keeping the shape in one place is what
 * lets the settings page, the studio page and the backend agree on a profile
 * without any of them owning the format.
 *
 * GPT-SoVITS itself is untouched: Servant only talks to its official `api_v2.py`
 * on `127.0.0.1:9880` (configurable through `GPT_SOVITS_URL`).
 */

/** Backend namespace. Everything below it is served by `server/gptsovits/gptSovitsApi.ts`. */
export const GPT_SOVITS_API_PREFIX = '/api/gpt-sovits';

/** Standalone studio page, copied from the `gpt-sovtest` prototype. */
export const GPT_SOVITS_STUDIO_PAGE = '/pages/gpt-sovits.html';

/** Directory under the writable data root: `studio.json` + `references/`. */
export const GPT_SOVITS_DATA_DIRECTORY = 'gpt-sovits';

/** Role presets file, relative to {@link GPT_SOVITS_DATA_DIRECTORY}. */
export const GPT_SOVITS_STUDIO_FILE = 'studio.json';

export const GPT_SOVITS_EMOTIONS = [
  'neutral',
  'happy',
  'shy',
  'sad',
  'angry',
  'curious',
  'concerned'
] as const;

export type GptSovitsEmotion = (typeof GPT_SOVITS_EMOTIONS)[number];

/** Sampling parameters of `api_v2.py` `/tts`. Same defaults as its WebUI. */
export interface GptSovitsSynthesisSettings {
  top_k: number;
  top_p: number;
  temperature: number;
  speed_factor: number;
  text_split_method: string;
  batch_size: number;
  batch_threshold: number;
  split_bucket: boolean;
  repetition_penalty: number;
  seed: number;
  parallel_infer: boolean;
  sample_steps: number;
  super_sampling: boolean;
  fragment_interval: number;
  streaming_mode: number;
}

export interface GptSovitsReference {
  /** Absolute path on the machine running Servant. */
  audio: string;
  /** Transcript of `audio`; GPT-SoVITS needs it verbatim. */
  text: string;
  lang: string;
}

export interface GptSovitsProfile {
  id: string;
  name: string;
  /** Absolute weight paths. Empty means "keep whatever 9880 has loaded". */
  models: { gpt: string; sovits: string };
  text_lang: string;
  references: Record<string, GptSovitsReference>;
  settings: GptSovitsSynthesisSettings;
}

export interface GptSovitsWeightEntry {
  name: string;
  /** `上一层级目录名/文件名`, matching the official WebUI list. */
  label: string;
  file: string;
  version: string;
  path: string;
  dir?: string;
  preset: boolean;
  alias?: string;
  rel: string;
}

export interface GptSovitsScanResult {
  gpt: GptSovitsWeightEntry[];
  sovits: GptSovitsWeightEntry[];
  root: string;
  /**
   * Set only when the typed root had to be corrected by one level to find weights
   * (e.g. the install dir was the inner `GPT_SoVITS` or the folder that contains
   * the repo). The UI should surface it so the swap is never silent.
   */
  scanRoot?: string;
  missing: string[];
  error?: string;
}

export interface GptSovitsHealth {
  connected: boolean;
  description: string;
  version?: string;
  schema?: string[] | null;
}

export interface GptSovitsLoadedWeights {
  gpt: string;
  sovits: string;
}

export interface GptSovitsState {
  /** GPT-SoVITS install root, used to scan weights and to sandbox audio reads. */
  root: string;
  profiles: GptSovitsProfile[];
  apiUrl: string;
  loaded: GptSovitsLoadedWeights;
}

export const DEFAULT_GPT_SOVITS_SETTINGS: Readonly<GptSovitsSynthesisSettings> = Object.freeze({
  top_k: 15,
  top_p: 1,
  temperature: 1,
  speed_factor: 1,
  text_split_method: 'cut5',
  batch_size: 1,
  batch_threshold: 0.75,
  split_bucket: true,
  repetition_penalty: 1.35,
  seed: -1,
  parallel_infer: true,
  sample_steps: 32,
  super_sampling: false,
  fragment_interval: 0.3,
  streaming_mode: 0
});

/** Request body of `POST ${GPT_SOVITS_API_PREFIX}/tts`. */
export interface GptSovitsTtsRequest {
  /** Role preset id, as chosen in the voice settings. */
  profileId?: string;
  /** Full preset, used by the studio page before a role is saved. */
  profile?: GptSovitsProfile;
  text: string;
  emotion?: GptSovitsEmotion;
}

/** Response headers of the `/tts` route, used by the studio page's stats panel. */
export const GPT_SOVITS_TTS_HEADERS = {
  elapsedMs: 'X-Elapsed-Ms',
  usedEmotion: 'X-Used-Emotion',
  loadedGpt: 'X-Loaded-Gpt',
  loadedSovits: 'X-Loaded-Sovits'
} as const;
