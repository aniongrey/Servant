import { resolveApiUrl } from '../../app/network/apiBase.ts';
import {
  provisioningAssetPath,
  STT_MODEL_RESOURCE_ID
} from '../../app/provisioning/provisioningTypes.ts';

/**
 * Directory the SenseVoice runtime is served from.
 *
 * Named for the engine, not for a model: the runtime (the WASM binary, the glue
 * and the two Silero VAD exports, ~17MB) ships with the app, while the model it
 * loads is downloaded to a directory only the backend can read. Keeping the two
 * apart is what stops "no model yet" from looking like "no engine".
 */
export const RUNTIME_BASE_PATH = '/engines/sensevoice';
export const AUDIO_WORKLET_URL = `${RUNTIME_BASE_PATH}/audio-input-worklet.js`;
export const TARGET_SAMPLE_RATE = 16_000;
export const VAD_FRAME_SIZE = 512;
export const WORKER_INITIALIZATION_TIMEOUT_MS = 120_000;

/**
 * Files the worker mounts into its WASM filesystem, named as they are stored
 * inside the `sherpa-asr-model` resource directory.
 */
export const ASR_ASSET_FILES = {
  model: 'model.int8.onnx',
  tokens: 'tokens.txt',
  vadV5: 'silero_vad_v5.onnx',
  vadLegacy: 'silero_vad_legacy.onnx'
} as const;

/**
 * URLs the worker fetches its model files from.
 *
 * The int8 model and its tokens are downloaded into the directory the user chose,
 * which the webview cannot address directly, so they are read back through the
 * backend's asset route. The Silero VAD models come from the sherpa-onnx release
 * rather than from the model repository and resolve from the bundled runtime
 * through that same route — one URL scheme for every file the worker needs, and
 * no knowledge of directory layout outside the manifest.
 *
 * Must be called after `ensureApiBase()`, so the URLs are absolute in the
 * packaged app where the page origin belongs to Tauri's asset protocol.
 */
export function createSenseVoiceAssetUrls(): Record<keyof typeof ASR_ASSET_FILES, string> {
  const urlOf = (file: string): string =>
    resolveApiUrl(provisioningAssetPath(STT_MODEL_RESOURCE_ID, file));
  return {
    model: urlOf(ASR_ASSET_FILES.model),
    tokens: urlOf(ASR_ASSET_FILES.tokens),
    vadV5: urlOf(ASR_ASSET_FILES.vadV5),
    vadLegacy: urlOf(ASR_ASSET_FILES.vadLegacy)
  };
}

export function createSenseVoiceConfig() {
  return {
    featConfig: { sampleRate: TARGET_SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      tokens: '/openllm-tokens.txt',
      numThreads: 4,
      debug: 0,
      provider: 'cpu',
      senseVoice: {
        model: '/openllm-model.int8.onnx',
        language: 'zh',
        useInverseTextNormalization: 1
      }
    },
    decodingMethod: 'greedy_search'
  };
}

export function createSileroVadConfig() {
  return {
    sileroVad: {
      model: '/openllm-silero-vad-v5.onnx',
      threshold: 0.35,
      minSilenceDuration: 0.32,
      minSpeechDuration: 0.096,
      maxSpeechDuration: 20,
      windowSize: VAD_FRAME_SIZE
    },
    tenVad: {
      model: '',
      threshold: 0.35,
      minSilenceDuration: 0.32,
      minSpeechDuration: 0.096,
      maxSpeechDuration: 20,
      windowSize: 256
    },
    sampleRate: TARGET_SAMPLE_RATE,
    numThreads: 1,
    provider: 'cpu',
    debug: 0,
    bufferSizeInSeconds: 30
  };
}
