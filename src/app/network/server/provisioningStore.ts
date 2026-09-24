/**
 * Where the provisioning state lives on disk, and where models are downloaded to.
 *
 * Models are the bulk of Shiro's footprint, so they are deliberately *not*
 * written into the per-user data directory: the user picks a directory once and
 * it is persisted with the rest of the setup state. Everything downstream follows
 * from that single answer —
 *
 * - the directory a repository is pulled into,
 * - the roots the asset route searches before answering the webview,
 * - the path handed to the Python memory service through `SHIRO_EMBEDDING_MODEL`.
 *
 * Reading is synchronous on purpose: the memory service resolves its model path
 * while spawning a child process, where there is no async context to await in.
 * The state file is a few hundred bytes on local disk.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_DOWNLOAD_DIRECTORY,
  normalizeProvisioningState,
  PROVISIONING_STATE_FILE,
  type ProvisioningState
} from '../../provisioning/provisioningTypes.ts';
import { mutableFile, writeMutableFile, type ProjectPaths } from './projectPaths.ts';
import { publishSharedModelRoot } from './sharedModelRoots.ts';
import type { ResourceManifestEntry } from './resourceManifest.ts';

/** Synchronous by design: the memory service resolves paths while spawning. */
export function readProvisioningStateSync(paths: ProjectPaths): ProvisioningState {
  return normalizeProvisioningState(readJsonSync(mutableFile(paths, PROVISIONING_STATE_FILE)));
}

function readJsonSync(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

export async function writeProvisioningState(paths: ProjectPaths, state: ProvisioningState): Promise<void> {
  await writeMutableFile(
    paths,
    PROVISIONING_STATE_FILE,
    `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`
  );
  // Every path that makes a download root official — the wizard's finish, a
  // download that just persisted a newly typed directory — also tells the *other*
  // Shiro builds on this machine where the models are. This is the single choke
  // point for that, so no call site can forget it. An empty root is left alone
  // rather than erased: it means "keep the default", not "forget where the models
  // went" (`sharedModelRoots.ts`).
  const root = state.downloadRoot.trim();
  if (root) await publishSharedModelRoot(root);
}

/** Default download root: a `models/` folder beside the app. */
export function defaultDownloadRoot(paths: ProjectPaths): string {
  return path.resolve(paths.root, DEFAULT_DOWNLOAD_DIRECTORY);
}

/**
 * The directory models are downloaded to: the user's choice when they made one,
 * otherwise {@link defaultDownloadRoot}.
 */
export function downloadRootOf(paths: ProjectPaths, state?: ProvisioningState): string {
  const configured = (state ?? readProvisioningStateSync(paths)).downloadRoot.trim();
  return configured ? path.resolve(configured) : defaultDownloadRoot(paths);
}

/**
 * Absolute directories a resource's files may live in, in lookup order:
 *
 * 1. the download root (where a download writes, and the only root whose
 *    completion marker counts as "ready"),
 * 2. the manifest's mirrors (bundled runtime files, a pre-download-root copy),
 * 3. every shared model root this machine knows about, with the same
 *    `<root>/<relative>` layout a download root has (`sharedModelRoots.ts`).
 *
 * Everything after the first entry is read-only and searched, never written to.
 * Duplicates are dropped: a shared root that happens to *be* the chosen root
 * would otherwise be searched twice.
 */
export function resourceRoots(
  paths: ProjectPaths,
  entry: ResourceManifestEntry,
  downloadRoot?: string,
  sharedRoots: readonly string[] = []
): string[] {
  const root = downloadRoot ?? downloadRootOf(paths);
  return uniquePaths([
    path.resolve(root, entry.relative),
    ...(entry.mirrors ?? []).map((mirror) =>
      mirror.base === 'bundle'
        ? path.resolve(paths.root, mirror.relative)
        : path.resolve(paths.data, mirror.relative)
    ),
    ...sharedRoots.map((shared) => path.resolve(shared, entry.relative))
  ]);
}

/** Windows compares paths case-insensitively; the same directory is not two roots. */
function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const candidate of paths) {
    const key = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

/**
 * Verifies a directory can actually be written to, returning a user-facing
 * reason when it cannot.
 *
 * Without this probe an unwritable target (a Program Files install, a read-only
 * or missing drive, a permission problem) surfaces as "every download site
 * failed", which sends the user chasing a network problem that does not exist.
 */
export function downloadRootProblem(directory: string): string | null {
  try {
    mkdirSync(directory, { recursive: true });
  } catch (error) {
    return `下载目录无法创建：${directory}（${describe(error)}）`;
  }
  const probe = path.join(directory, '.shiro-write-probe');
  try {
    writeFileSync(probe, 'ok');
  } catch (error) {
    return `下载目录不可写：${directory}（${describe(error)}）`;
  } finally {
    try {
      rmSync(probe, { force: true });
    } catch {
      // A leftover probe file is harmless.
    }
  }
  return null;
}

function describe(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'EACCES' || code === 'EPERM') return '权限不足';
  if (code === 'ENOENT') return '磁盘或路径不存在';
  if (code === 'ENOSPC') return '磁盘空间不足';
  if (code === 'EROFS') return '只读文件系统';
  return error instanceof Error ? error.message : String(error);
}

/** True when the directory exists (used to prefer an existing model copy). */
export function directoryExists(directory: string): boolean {
  return existsSync(directory);
}
