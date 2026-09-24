let offlineRecognizer = null;
let voiceActivityDetector = null;
let expectedSampleRate = 16000;
let vadSpeechActive = false;
let vadSampleCursor = 0;
let vadHistory = [];
const VAD_PADDING_SAMPLES = Math.round(16000 * 0.32);
const VAD_HISTORY_SAMPLES = Math.round(16000 * 2);
// Bare names resolve against this worker's own directory. The runtime directory
// no longer carries a model or a token table — those exist only in the directory
// the user prepared, which the webview cannot address — so the page always passes
// absolute asset-route URLs in `init.assets`. What the runtime *does* still ship
// beside the worker is the two Silero VAD exports, which no model repository
// provides; resolving them by bare name is what makes a missing VAD download
// harmless. These entries also keep an older caller working.
const OPENLLM_ASSET_FALLBACK_URLS = {
  model: 'model.int8.onnx',
  tokens: 'tokens.txt',
  vadV5: 'silero_vad_v5.onnx',
  vadLegacy: 'silero_vad_legacy.onnx'
};
const OPENLLM_MODEL_FS_PATH = '/openllm-model.int8.onnx';
const OPENLLM_TOKENS_FS_PATH = '/openllm-tokens.txt';
const OPENLLM_VAD_V5_FS_PATH = '/openllm-silero-vad-v5.onnx';
const OPENLLM_VAD_LEGACY_FS_PATH = '/openllm-silero-vad-legacy.onnx';

/**
 * `init.assets` wins per key; a missing or blank entry falls back to the sibling
 * file. Resolving one key at a time keeps a half-configured caller working
 * instead of losing every URL to a single omission.
 */
function resolveAssetUrls(assets) {
  const provided = assets && typeof assets === 'object' ? assets : {};
  const urlOf = (key) => {
    const value = provided[key];
    return typeof value === 'string' && value.length > 0 ? value : OPENLLM_ASSET_FALLBACK_URLS[key];
  };
  return {
    model: urlOf('model'),
    tokens: urlOf('tokens'),
    vadV5: urlOf('vadV5'),
    vadLegacy: urlOf('vadLegacy')
  };
}
let runtimeReadyResolve = null;
let runtimeReadyReject = null;
let lastDownloadLogPercent = -1;
const isPthreadWorker = self.name?.startsWith('em-pthread') === true;
if (!isPthreadWorker) console.info('[SenseVoice Worker] booting official SenseVoice runtime');
const runtimeReady = new Promise((resolve, reject) => {
  runtimeReadyResolve = resolve;
  runtimeReadyReject = reject;
});

self.Module = {
  locateFile(path, scriptDirectory = '') {
    return scriptDirectory + path;
  },
  /**
   * Skips the official `.data` package, which is a hard run dependency of the
   * glue otherwise.
   *
   * That package is ~229MB of preloaded filesystem — a copy of the int8 model,
   * the token table and an unused Silero export — and every byte of it is
   * redundant: the page names the real files and `mountExternalFile` puts them
   * into the WASM filesystem itself, from a directory the installer never
   * carries. Emscripten asks this hook before it fetches anything, so returning
   * an empty buffer satisfies the dependency without shipping the duplicate.
   * The empty entries it then writes are zero-byte placeholders under the
   * package's own names; nothing reads them.
   */
  getPreloadedPackage() {
    return new ArrayBuffer(0);
  },
  onAbort(reason) {
    console.error('[SenseVoice Worker] Module abort', reason);
    if (runtimeReadyReject) {
      runtimeReadyReject(reason);
      runtimeReadyReject = null;
    }
  },
  onRuntimeInitialized() {
    runtimeReadyResolve();
    runtimeReadyResolve = null;
  },
  print() {},
  printErr(text) {
    console.error('[SenseVoice Worker stderr]', text);
  },
  setStatus(status) {
    const match = /\((\d+)\/(\d+)\)/.exec(status);
    if (!match) return;
    const percent = Math.floor(Number(match[1]) / Number(match[2]) * 100);
    const roundedPercent = Math.min(100, Math.floor(percent / 25) * 25);
    if (roundedPercent > lastDownloadLogPercent) {
      lastDownloadLogPercent = roundedPercent;
      console.info(`[SenseVoice Worker] loading official data package: ${roundedPercent}%`);
    }
  },
};

try {
  importScripts('sherpa-onnx-wasm-main-vad-asr.js');
  importScripts('sherpa-onnx-asr.js');
  importScripts('sherpa-onnx-vad.js');
} catch (err) {
  console.error('[SenseVoice Worker] Failed to import scripts', err);
  if (runtimeReadyReject) {
    runtimeReadyReject(err);
  }
}

function toErrorMessage(err) {
  if (!err) {
    return 'Unknown error';
  }
  if (typeof err === 'string') {
    return err;
  }
  if (err instanceof Error) {
    return err.message;
  }
  try {
    return JSON.stringify(err);
  } catch (jsonErr) {
    return String(err);
  }
}

async function ensureRuntimeReady() {
  return runtimeReady;
}

function assertMountedFile(path) {
  const length = Module.lengthBytesUTF8(path) + 1;
  const pointer = Module._malloc(length);
  try {
    Module.stringToUTF8(path, pointer, length);
    if (Module._SherpaOnnxFileExists(pointer) !== 1) {
      throw new Error(`SenseVoice file is unavailable: ${path}`);
    }
  } finally {
    Module._free(pointer);
  }
}

/**
 * Fetches one asset, then retries beside the worker.
 *
 * The URL the page supplies goes through the backend, which can read a model
 * the webview cannot address — a directory the user picked outside the app. The
 * sibling copy is tried second, which is what keeps the two Silero VAD exports
 * working before anything has been downloaded. The model and token table have no
 * sibling left to fall back to, so a failure names every location it tried.
 */
async function fetchAssetWithFallback(url, fallbackUrl) {
  const candidates = fallbackUrl && fallbackUrl !== url ? [url, fallbackUrl] : [url];
  const problems = [];
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { credentials: 'same-origin' });
      if (response.ok) return { response, url: candidate };
      problems.push(
        response.status === 404
          ? `未找到 ${candidate}`
          : `无法读取 ${candidate}（HTTP ${response.status}）`
      );
    } catch (err) {
      problems.push(`无法读取 ${candidate}（${toErrorMessage(err)}）`);
    }
  }
  // Turning "nothing there" into an actionable sentence beats a bare
  // "recognizer could not be created" three steps later.
  throw new Error(
    `语音识别资源不可用：${problems.join('；')}。模型文件请先在初始化面板下载「语音识别模型 · SenseVoice」；若是 VAD 文件，说明运行时资源不完整。`
  );
}

async function mountExternalFile(url, fsPath, fallbackUrl) {
  const { response, url: loadedUrl } = await fetchAssetWithFallback(url, fallbackUrl);
  const data = new Uint8Array(await response.arrayBuffer());
  try {
    Module.FS_unlink(fsPath);
  } catch {}
  Module.FS_createDataFile('/', fsPath.replace(/^\//, ''), data, true, true, true);
  console.info('[SenseVoice Worker] mounted OpenLLM voice asset', {
    url: loadedUrl,
    fsPath,
    bytes: data.byteLength
  });
}

function ensureRecognizerReady() {
  if (!offlineRecognizer) {
    throw new Error('Offline recognizer not initialised');
  }
  return offlineRecognizer;
}

function ensureVadReady() {
  if (!voiceActivityDetector) {
    throw new Error('Voice activity detector not initialised');
  }
  return voiceActivityDetector;
}

function resetVadHistory() {
  vadSampleCursor = 0;
  vadHistory = [];
}

function rememberVadFrame(samples) {
  const retained = new Float32Array(samples);
  vadHistory.push({ start: vadSampleCursor, end: vadSampleCursor + retained.length, samples: retained });
  vadSampleCursor += retained.length;
  const oldestToKeep = Math.max(0, vadSampleCursor - VAD_HISTORY_SAMPLES);
  while (vadHistory.length > 0 && vadHistory[0].end <= oldestToKeep) {
    vadHistory.shift();
  }
}

function collectVadPadding(start, end) {
  if (end <= start) return new Float32Array();
  const chunks = [];
  let total = 0;
  for (const frame of vadHistory) {
    if (frame.end <= start || frame.start >= end) continue;
    const from = Math.max(start, frame.start) - frame.start;
    const to = Math.min(end, frame.end) - frame.start;
    const chunk = frame.samples.slice(from, to);
    chunks.push(chunk);
    total += chunk.length;
  }
  return concatFloat32(chunks, total);
}

function concatFloat32(chunks, knownLength) {
  const length = knownLength ?? chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function drainVadSegments() {
  const vad = ensureVadReady();
  while (!vad.isEmpty()) {
    const segment = vad.front();
    vad.pop();
    const padding = collectVadPadding(Math.max(0, segment.start - VAD_PADDING_SAMPLES), segment.start);
    const samples = concatFloat32([padding, segment.samples]);
    vadSpeechActive = false;
    self.postMessage(
      {
        type: 'vad-event',
        event: 'speech-end',
        samples: samples.length,
        start: segment.start,
        audioBuffer: samples.buffer,
      },
      [samples.buffer]
    );
  }
}

function createOpenLlmVad(config) {
  const candidates = [
    { label: 'OpenLLM silero_vad_v5.onnx', path: OPENLLM_VAD_V5_FS_PATH },
    { label: 'OpenLLM silero_vad_legacy.onnx', path: OPENLLM_VAD_LEGACY_FS_PATH }
  ];
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const candidateConfig = {
        ...config,
        sileroVad: {
          ...config.sileroVad,
          model: candidate.path
        }
      };
      const vad = createVad(Module, candidateConfig);
      if (!vad.handle) throw new Error(`VAD handle is empty for ${candidate.label}`);
      console.info('[SenseVoice Worker] VAD ready', {
        source: candidate.label,
        config: candidateConfig
      });
      return vad;
    } catch (err) {
      lastError = err;
      console.warn('[SenseVoice Worker] VAD candidate failed', {
        source: candidate.label,
        message: toErrorMessage(err)
      });
    }
  }
  throw lastError ?? new Error('No OpenLLM Silero VAD model could be created.');
}

if (!isPthreadWorker) self.onmessage = async (event) => {
  const data = event.data || {};
  const { type } = data;

  if (type === 'init') {
    expectedSampleRate = data.sampleRate || expectedSampleRate;
    const config = data.config;
    try {
      await ensureRuntimeReady();
      const assetUrls = resolveAssetUrls(data.assets);
      console.info('[SenseVoice Worker] runtime ready; mounting OpenLLM SenseVoice files', assetUrls);
      await mountExternalFile(assetUrls.model, OPENLLM_MODEL_FS_PATH, OPENLLM_ASSET_FALLBACK_URLS.model);
      await mountExternalFile(assetUrls.tokens, OPENLLM_TOKENS_FS_PATH, OPENLLM_ASSET_FALLBACK_URLS.tokens);
      await mountExternalFile(assetUrls.vadV5, OPENLLM_VAD_V5_FS_PATH, OPENLLM_ASSET_FALLBACK_URLS.vadV5);
      await mountExternalFile(
        assetUrls.vadLegacy,
        OPENLLM_VAD_LEGACY_FS_PATH,
        OPENLLM_ASSET_FALLBACK_URLS.vadLegacy
      );
      assertMountedFile(OPENLLM_MODEL_FS_PATH);
      assertMountedFile(OPENLLM_TOKENS_FS_PATH);
      assertMountedFile(OPENLLM_VAD_V5_FS_PATH);
      assertMountedFile(OPENLLM_VAD_LEGACY_FS_PATH);
      console.info('[SenseVoice Worker] creating recognizer', config);
      offlineRecognizer = new OfflineRecognizer(config, Module);
      if (!offlineRecognizer.handle) {
        throw new Error('SenseVoice recognizer could not be created. Check the bundled official model and tokens.');
      }
      console.info('[SenseVoice Worker] recognizer ready', {
        sampleRate: expectedSampleRate,
        language: config?.modelConfig?.senseVoice?.language
      });
      voiceActivityDetector = createOpenLlmVad(data.vadConfig);
      self.postMessage({ type: 'ready' });
    } catch (err) {
      const message = toErrorMessage(err);
      console.error('[SenseVoice Worker] init failed', err);
      self.postMessage({ type: 'init-error', message });
    }
    return;
  }

  if (type === 'vad-reset') {
    try {
      vadSpeechActive = false;
      resetVadHistory();
      ensureVadReady().reset();
      self.postMessage({ type: 'vad-event', event: 'reset' });
    } catch (err) {
      self.postMessage({ type: 'vad-error', message: toErrorMessage(err) });
    }
    return;
  }

  if (type === 'vad-frame') {
    try {
      await ensureRuntimeReady();
      const vad = ensureVadReady();
      const samples = new Float32Array(data.audioBuffer);
      rememberVadFrame(samples);
      vad.acceptWaveform(samples);
      if (vad.isDetected() && !vadSpeechActive) {
        vadSpeechActive = true;
        self.postMessage({ type: 'vad-event', event: 'speech-start' });
      }
      drainVadSegments();
    } catch (err) {
      self.postMessage({ type: 'vad-error', message: toErrorMessage(err) });
    }
    return;
  }

  if (type === 'vad-flush') {
    try {
      await ensureRuntimeReady();
      ensureVadReady().flush();
      drainVadSegments();
      if (vadSpeechActive) {
        vadSpeechActive = false;
        self.postMessage({ type: 'vad-event', event: 'vad-misfire' });
      }
    } catch (err) {
      self.postMessage({ type: 'vad-error', message: toErrorMessage(err) });
    }
    return;
  }

  if (type === 'decode') {
    const jobId = data.id;
    const audioBuffer = data.audioBuffer;
    const sampleRate = data.sampleRate || expectedSampleRate;

    try {
      await ensureRuntimeReady();
      const recognizer = ensureRecognizerReady();
      const samples = new Float32Array(audioBuffer);
      const start = performance.now();
      console.info(`[SenseVoice Worker] decoding job #${jobId}`, {
        sampleRate,
        samples: samples.length,
        durationMs: Math.round(samples.length / sampleRate * 1000)
      });
      const stream = recognizer.createStream();
      stream.acceptWaveform(sampleRate, samples);
      recognizer.decode(stream);
      const result = recognizer.getResult(stream);
      stream.free();
      const elapsedMs = performance.now() - start;
      console.info(`[SenseVoice Worker] decoded job #${jobId}`, {
        elapsedMs: Math.round(elapsedMs),
        text: result?.text ?? ''
      });
      self.postMessage({
        type: 'decode-result',
        id: jobId,
        result,
        elapsedMs,
      });
    } catch (err) {
      const message = toErrorMessage(err);
      console.error(`[SenseVoice Worker] Job #${jobId} decode failed`, err);
      self.postMessage({ type: 'decode-error', id: jobId, message });
    }
    return;
  }

  if (type === 'dispose') {
    try {
      if (offlineRecognizer) {
        offlineRecognizer.free();
        offlineRecognizer = null;
      }
      if (voiceActivityDetector) {
        voiceActivityDetector.free();
        voiceActivityDetector = null;
      }
    } catch (err) {
      console.error('[SenseVoice Worker] dispose failed', err);
    } finally {
      self.postMessage({ type: 'disposed' });
      close();
    }
    return;
  }
};
