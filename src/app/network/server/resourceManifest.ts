/**
 * Server-side catalog of what the setup wizard can prepare.
 *
 * This is the single source of truth for "what can be downloaded" and is never
 * shipped to the browser: the wizard only ever sees resource *ids*, labels and
 * sizes, while the repository references and download endpoints stay here.
 * Adding a model is a one-entry manifest edit — no client or route changes.
 *
 * Every entry is a whole-repository pull, never a hand-written file list. An
 * earlier hand-maintained list silently omitted `vocab.json` / `merges.txt`,
 * which would have produced an unusable tokenizer without failing; asking the
 * site what the repository contains makes that class of bug impossible.
 *
 * Anything the installer already carries is deliberately *absent* from this
 * table: the panel exists to fetch what is not shipped, so bundled code (the
 * Python memory environment, the sherpa-onnx WASM runtime) must not be listed
 * as something to "prepare".
 */

import type { FeatureId } from '../../provisioning/provisioningTypes.ts';
import { MEMORY_MODEL_RESOURCE_ID, STT_MODEL_RESOURCE_ID } from '../../provisioning/provisioningTypes.ts';
import type { ModelRepoRef } from './modelRepository.ts';

export interface ResourceManifestEntry {
  id: string;
  label: string;
  /** Capability this download enables (matches `FeatureId` on the client). */
  feature: FeatureId;
  /** Directory under the configured download root that files are pulled into. */
  relative: string;
  /**
   * Extra directories searched for this resource's files, *after* the download
   * root and never written to.
   *
   * `bundle` names a read-only directory beside the app (files the installer
   * already carries, or ones no repository ships — the Silero VAD models come
   * from the sherpa-onnx release rather than from the SenseVoice repo). `data`
   * names the per-user data directory, which is where a model may already live
   * from before the download root became configurable.
   *
   * Mirrors keep a resource usable without re-downloading it, but they do not
   * make it "ready": readiness is a completion marker in the download root, so
   * the panel still offers to bring the copy under the user's chosen directory.
   *
   * The per-user *shared* model roots (`provisioningStore.resourceRoots()`) are
   * searched after these and are deliberately not listed here: they are not a
   * property of a resource, but the same `<root>/<relative>` layout every entry
   * already has, and which build recorded them is not the manifest's business.
   */
  mirrors?: readonly ResourceMirror[];
  /**
   * Files that must sit inside a resource directory for the runtime to work.
   *
   * A completion marker (`modelRepository.REPO_MARKER_FILE`) is the strong
   * signal — it is written only after a repository was pulled whole — but it is
   * absent for every copy that predates it, or that the user placed by hand.
   * Those copies are perfectly usable, so the first-run gate asks this list
   * instead: "are the files the runtime actually loads here?" A directory with
   * `model.int8.onnx` but no `tokens.txt` is a half-download and must not pass.
   *
   * Keep it to what cannot be regenerated: a weights file plus whatever the
   * loader needs beside it.
   */
  requiredFiles: readonly string[];
  /** Estimated payload size, refined from the site's file list during a pull. */
  sizeBytes: number;
  description: string;
  /** Repository to pull. Resolved by the backend at download time. */
  repo: ModelRepoRef;
}

export interface ResourceMirror {
  /** `bundle` = read-only app directory, `data` = per-user data directory. */
  base: 'bundle' | 'data';
  relative: string;
}

export const RESOURCE_MANIFEST: readonly ResourceManifestEntry[] = [
  {
    id: STT_MODEL_RESOURCE_ID,
    label: '语音识别模型 · SenseVoice',
    feature: 'stt',
    // Models live under the user's chosen download root, never inside the
    // installer: the model is what makes the installer huge, and it can be
    // re-fetched at will. The mirror points at the bundled *runtime* rather than
    // at a bundled model, so it can only satisfy the two Silero VAD exports —
    // the int8 model and its token table exist nowhere but the download root.
    relative: 'sherpa-asr',
    mirrors: [{ base: 'bundle', relative: 'public/engines/sensevoice' }],
    // Exactly the `include` list: the two files a working ASR needs, and the two
    // files a pull writes here. Neither exists in the bundled runtime.
    requiredFiles: ['model.int8.onnx', 'tokens.txt'],
    sizeBytes: 239_549_735,
    description:
      '中/英/日/韩/粤语本地识别模型（int8 量化，约 228MB）。仓库里 894MB 的 float32 变体与说明文件不会下载；VAD 与 WASM 运行时属于引擎，随应用提供。下载后麦克风输入完全离线，不需要联网。',
    repo: {
      repo: 'pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue',
      // The repository also carries a 894.2 MiB float32 `model.onnx` that the WASM
      // runtime never loads; an allow-list keeps it off the wire.
      include: ['model.int8.onnx', 'tokens.txt']
    }
  },
  {
    id: MEMORY_MODEL_RESOURCE_ID,
    label: '长期记忆嵌入模型 · Qwen3-Embedding-0.6B',
    feature: 'memory',
    relative: 'Qwen3-Embedding-0.6B',
    // The memory service used to resolve `.local/models/...` relative to the data
    // directory; keeping that as a mirror means an existing copy keeps working
    // while the panel offers to move it under the chosen download root.
    mirrors: [{ base: 'data', relative: '.local/models/Qwen3-Embedding-0.6B' }],
    // The weights plus what the loader reads beside them; a copy missing the
    // tokenizer loads no further than the config.
    requiredFiles: ['model.safetensors', 'config.json', 'tokenizer.json'],
    sizeBytes: 1_207_500_000,
    description: '把对话变成可检索的向量（约 1.2GB）。下载后长期记忆完全离线运行，缺少它记忆检索无法启动。',
    repo: { repo: 'Qwen/Qwen3-Embedding-0.6B' }
  }
];

const RESOURCE_BY_ID = new Map(RESOURCE_MANIFEST.map((resource) => [resource.id, resource]));

export function getResourceEntry(id: string): ResourceManifestEntry | undefined {
  return RESOURCE_BY_ID.get(id);
}
