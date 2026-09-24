/**
 * Pulls *whole* model repositories from a pluggable download site.
 *
 * The unit of provisioning is a repository, not a file: the manifest names
 * `Qwen/Qwen3-Embedding-0.6B` and the site is asked what it contains, so the
 * file list can never drift from what the model actually ships (an earlier
 * hand-maintained list silently omitted `vocab.json` / `merges.txt` /
 * `1_Pooling/config.json`, which would have produced an unusable tokenizer).
 *
 * Adding a site means adding one descriptor to {@link MODEL_SITES}; the
 * manifest, the API and the wizard all stay untouched.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fetch as undiciFetch } from 'undici';
import type { ModelSiteId } from '../../provisioning/provisioningTypes.ts';
import {
  DOWNLOAD_USER_AGENT,
  downloadResourceToFile,
  fileSizeAt,
  type FetchLike,
  type ResourceDownloadOptions
} from './resourceDownloader.ts';

/** A repository reference, independent of which site hosts it. */
export interface ModelRepoRef {
  /** `owner/name`, e.g. `Qwen/Qwen3-Embedding-0.6B`. */
  repo: string;
  /** Overrides the site's default branch/tag when set. */
  revision?: string;
  /**
   * When set, only repository files whose path matches one of these patterns are
   * pulled. Repositories routinely ship variants we never load — the SenseVoice
   * repo carries a 228.2 MiB int8 model the WASM runtime uses alongside a
   * 894.2 MiB float32 sibling it never loads (sizes as reported by the site) —
   * so a whole-repo pull needs an allow-list to stay honest about how much it
   * downloads.
   *
   * Patterns are matched against the repository-relative path: `*` and `?` never
   * cross a `/`, `**` does. Omit to pull everything.
   */
  include?: readonly string[];
}

/**
 * Glob match for repository-relative paths.
 *
 * Deliberately tiny and strict (no implicit basename matching): a pattern either
 * describes the path as stored in the repository or it does not, which keeps the
 * "how many bytes will this download" answer predictable.
 */
export function repoPathMatches(path: string, pattern: string): boolean {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        // `**/` spans *zero* or more directories, so `**/*.json` has to match a
        // top-level `config.json` as well as a nested one.
        if (pattern[index + 2] === '/') {
          source += '(?:.*/)?';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`).test(path);
}

function matchesInclude(path: string, include?: readonly string[]): boolean {
  if (!include || include.length === 0) return true;
  return include.some((pattern) => repoPathMatches(path, pattern));
}

export interface RepoFileEntry {
  /** Path relative to the repository root, e.g. `1_Pooling/config.json`. */
  path: string;
  /** Declared size in bytes; 0 when the site does not report one. */
  sizeBytes: number;
}

export interface ModelSite {
  id: ModelSiteId;
  label: string;
  /** Revision used when a repo ref does not pin one. */
  defaultRevision: string;
  listUrl: (repo: string, revision: string) => string;
  fileUrl: (repo: string, revision: string, path: string) => string;
  parseList: (payload: unknown) => RepoFileEntry[];
}

/** Name of the marker file written into a repository once fully pulled. */
export const REPO_MARKER_FILE = '.servant-provisioning.json';

const MODELSCOPE_BASE = 'https://www.modelscope.cn';

/** Encodes each path segment, preserving the separators. */
function encodeRepoPath(path: string): string {
  return path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join('/');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function numeric(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * ModelScope `…/repo/files` response:
 * `{ Data: { Files: [{ Path, Size, Type: 'blob' | 'tree' }] } }`
 */
export function parseModelScopeFileList(payload: unknown): RepoFileEntry[] {
  const files = asRecord(asRecord(payload)?.Data)?.Files;
  if (!Array.isArray(files)) return [];
  const entries: RepoFileEntry[] = [];
  for (const item of files) {
    const record = asRecord(item);
    if (!record) continue;
    if (record.Type !== 'blob') continue;
    const path = typeof record.Path === 'string' ? record.Path : '';
    if (!path) continue;
    entries.push({ path, sizeBytes: numeric(record.Size) });
  }
  return entries;
}

/**
 * HuggingFace tree response: `[{ type: 'file' | 'directory', path, size }]`.
 * LFS-tracked files report their real size under `lfs.size`.
 */
export function parseHuggingFaceFileList(payload: unknown): RepoFileEntry[] {
  if (!Array.isArray(payload)) return [];
  const entries: RepoFileEntry[] = [];
  for (const item of payload) {
    const record = asRecord(item);
    if (!record) continue;
    if (record.type !== 'file') continue;
    const path = typeof record.path === 'string' ? record.path : '';
    if (!path) continue;
    const lfsSize = numeric(asRecord(record.lfs)?.size);
    entries.push({ path, sizeBytes: lfsSize || numeric(record.size) });
  }
  return entries;
}

export const MODEL_SITES: readonly ModelSite[] = [
  {
    id: 'modelscope',
    label: 'ModelScope 魔搭',
    defaultRevision: 'master',
    listUrl: (repo, revision) =>
      `${MODELSCOPE_BASE}/api/v1/models/${encodeRepoPath(repo)}/repo/files?Revision=${encodeURIComponent(
        revision
      )}&Recursive=True`,
    fileUrl: (repo, revision, path) =>
      `${MODELSCOPE_BASE}/api/v1/models/${encodeRepoPath(repo)}/repo?Revision=${encodeURIComponent(
        revision
      )}&FilePath=${encodeURIComponent(path)}`,
    parseList: parseModelScopeFileList
  },
  {
    id: 'hf-mirror',
    label: 'HuggingFace 镜像',
    defaultRevision: 'main',
    listUrl: (repo, revision) =>
      `https://hf-mirror.com/api/models/${encodeRepoPath(repo)}/tree/${encodeURIComponent(revision)}?recursive=true`,
    fileUrl: (repo, revision, path) =>
      `https://hf-mirror.com/${encodeRepoPath(repo)}/resolve/${encodeURIComponent(revision)}/${encodeRepoPath(path)}`,
    parseList: parseHuggingFaceFileList
  },
  {
    id: 'huggingface',
    label: 'HuggingFace 官方',
    defaultRevision: 'main',
    listUrl: (repo, revision) =>
      `https://huggingface.co/api/models/${encodeRepoPath(repo)}/tree/${encodeURIComponent(
        revision
      )}?recursive=true`,
    fileUrl: (repo, revision, path) =>
      `https://huggingface.co/${encodeRepoPath(repo)}/resolve/${encodeURIComponent(revision)}/${encodeRepoPath(path)}`,
    parseList: parseHuggingFaceFileList
  }
];

const SITE_BY_ID = new Map(MODEL_SITES.map((site) => [site.id, site]));

export function getModelSite(id: ModelSiteId): ModelSite {
  const site = SITE_BY_ID.get(id);
  if (!site) throw new Error(`Unknown model site: ${id}`);
  return site;
}

export interface RepoDownloadOptions extends ResourceDownloadOptions {
  /** Called before the file list is fetched, for UI feedback. */
  onListStart?: () => void;
  /** Called once the site reported its file list. */
  onListed?: (files: readonly RepoFileEntry[]) => void;
  /** Called before each file starts transferring. */
  onFileStart?: (file: RepoFileEntry, index: number, fileCount: number) => void;
  /** Called after each file lands on disk. */
  onFileDone?: (file: RepoFileEntry, index: number, fileCount: number) => void;
  /** Skip files already on disk with a matching size. Defaults to `true`. */
  skipExisting?: boolean;
}

export interface RepoDownloadResult {
  site: ModelSiteId;
  repo: string;
  revision: string;
  files: RepoFileEntry[];
  /** Files actually transferred (excluding skipped ones). */
  downloaded: number;
  /** Files that were already present and complete. */
  skipped: number;
  /** Total bytes transferred. */
  bytes: number;
}

/** Marker payload persisted next to a fully-downloaded repository. */
export interface RepoMarker {
  site: ModelSiteId;
  repo: string;
  revision: string;
  files: RepoFileEntry[];
  bytes: number;
  completedAt: string;
}

/**
 * Asks a site for the repository's file list.
 *
 * Empty results are an error rather than an empty download: a site that answers
 * with something unexpected (an HTML error page, a renamed endpoint) must not
 * look like "the model has no files".
 */
export async function listModelRepoFiles(
  site: ModelSite,
  ref: ModelRepoRef,
  options: Pick<ResourceDownloadOptions, 'signal' | 'fetchImpl'> = {}
): Promise<RepoFileEntry[]> {
  const revision = ref.revision ?? site.defaultRevision;
  const doFetch: FetchLike = options.fetchImpl ?? (undiciFetch as unknown as FetchLike);
  const response = await doFetch(site.listUrl(ref.repo, revision), {
    method: 'GET',
    redirect: 'follow',
    headers: { 'user-agent': DOWNLOAD_USER_AGENT, accept: 'application/json' },
    signal: options.signal
  });
  if (!response.ok) {
    throw new Error(`${site.label} 无法列出仓库文件：HTTP ${response.status}（${ref.repo}）`);
  }
  // Sites sometimes answer a 200 with an HTML error page; that must read as a
  // site failure so the caller moves on to the next source.
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${site.label} 返回了无法解析的文件列表（${ref.repo}）`);
  }
  const listed = site.parseList(payload);
  if (listed.length === 0) {
    throw new Error(`${site.label} 未返回任何文件（${ref.repo}@${revision}）`);
  }
  const files = listed.filter((file) => matchesInclude(file.path, ref.include));
  if (files.length === 0) {
    // A manifest bug, not a network problem: say so instead of letting it look
    // like every site is down.
    throw new Error(
      `${ref.repo} 的文件清单按 include 过滤后为空（配置错误，请检查 resourceManifest 的 include）`
    );
  }
  return files;
}

/** Reads the completion marker for a repository directory, or `null` when absent. */
export async function readModelRepoMarker(directory: string): Promise<RepoMarker | null> {
  try {
    const parsed = JSON.parse(await readFile(join(directory, REPO_MARKER_FILE), 'utf8')) as unknown;
    const record = asRecord(parsed);
    if (!record) return null;
    const files = Array.isArray(record.files)
      ? record.files.flatMap((item): RepoFileEntry[] => {
          const entry = asRecord(item);
          return entry && typeof entry.path === 'string'
            ? [{ path: entry.path, sizeBytes: numeric(entry.sizeBytes) }]
            : [];
        })
      : [];
    if (files.length === 0) return null;
    return {
      site: (typeof record.site === 'string' ? record.site : 'modelscope') as ModelSiteId,
      repo: typeof record.repo === 'string' ? record.repo : '',
      revision: typeof record.revision === 'string' ? record.revision : '',
      files,
      bytes: numeric(record.bytes),
      completedAt: typeof record.completedAt === 'string' ? record.completedAt : ''
    };
  } catch {
    return null;
  }
}

/**
 * Downloads every file of `ref` into `directory` in one operation, then writes
 * {@link REPO_MARKER_FILE} so later runs can tell "fully pulled" from "half
 * pulled" without re-listing the site.
 *
 * Aggregate progress is reported through `options.onProgress`, with per-file
 * granularity via `onFileStart` / `onFileDone`.
 */
export async function downloadModelRepo(
  site: ModelSite,
  ref: ModelRepoRef,
  directory: string,
  options: RepoDownloadOptions = {}
): Promise<RepoDownloadResult> {
  const revision = ref.revision ?? site.defaultRevision;
  options.onListStart?.();
  const files = await listModelRepoFiles(site, ref, options);
  options.onListed?.(files);

  const skipExisting = options.skipExisting ?? true;
  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  await mkdir(directory, { recursive: true });

  let receivedBytes = 0;
  let downloaded = 0;
  let skipped = 0;

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (options.signal?.aborted) throw new Error('aborted');
    const destination = join(directory, ...file.path.split('/'));

    const existing = skipExisting ? await fileSizeAt(directory, file.path) : null;
    if (existing !== null && (file.sizeBytes === 0 || existing === file.sizeBytes)) {
      skipped += 1;
      receivedBytes += existing;
      options.onProgress?.(receivedBytes, totalBytes);
      continue;
    }

    options.onFileStart?.(file, index, files.length);
    const baseBytes = receivedBytes;
    const written = await downloadResourceToFile(
      site.fileUrl(ref.repo, revision, file.path),
      destination,
      {
        signal: options.signal,
        fetchImpl: options.fetchImpl,
        proxyUrl: options.proxyUrl,
        headers: options.headers,
        onProgress: (fileReceived, fileTotal) => {
          // Prefer the site's declared size; some CDNs omit Content-Length.
          const effectiveTotal = fileTotal > 0 ? fileTotal : file.sizeBytes;
          const overallTotal = totalBytes > 0 ? totalBytes - file.sizeBytes + effectiveTotal : 0;
          options.onProgress?.(baseBytes + fileReceived, overallTotal);
        }
      }
    );
    receivedBytes = baseBytes + written;
    downloaded += 1;
    options.onFileDone?.(file, index, files.length);
    options.onProgress?.(receivedBytes, totalBytes);
  }

  const marker: RepoMarker = {
    site: site.id,
    repo: ref.repo,
    revision,
    files,
    bytes: receivedBytes,
    completedAt: new Date().toISOString()
  };
  await writeFile(join(directory, REPO_MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`, 'utf8');

  return { site: site.id, repo: ref.repo, revision, files, downloaded, skipped, bytes: receivedBytes };
}

/** Deletes the completion marker (used when a pull is rolled back). */
export async function clearModelRepoMarker(directory: string): Promise<void> {
  await rm(join(directory, REPO_MARKER_FILE), { force: true });
}
