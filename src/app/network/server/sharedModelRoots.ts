/**
 * The download roots every Servant build on this machine should search.
 *
 * The root the user chose is persisted with the rest of the setup state, but that
 * file lives in a *per-build* data directory: the standalone backend and the Vite
 * dev server write it into the checkout, while the desktop app writes it into
 * `%APPDATA%\<identifier>` (`projectPaths.ts`). Neither can see the other's, so a
 * machine that downloaded 1.4 GB of models in one build was asked to download
 * them again in the other — and the first-run gate could not even see that the
 * models were on disk.
 *
 * So a chosen root is *also* published here, in a per-user directory that is not
 * scoped to a bundle identifier. This is a hint and never an authority:
 *
 * - the state file still decides which directory downloads are written to;
 * - these roots are only *searched*, after the chosen root and the manifest
 *   mirrors, exactly like a mirror (`provisioningStore.resourceRoots()`).
 *
 * It is a list because one machine really does have several: a developer keeps
 * `E:\airi\models` for the checkout and lets the installed build use its default.
 * Writing never throws — a machine with no writable local app data (or a locked
 * file) must lose nothing but the hint.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Directory name inside the local app data root; shared on purpose. */
const SHARED_DIRECTORY = 'Servant';
export const SHARED_MODEL_ROOTS_FILE = 'model-roots.json';

/** Oldest entries are dropped past this: a guess list, not a registry. */
export const SHARED_MODEL_ROOTS_LIMIT = 4;

interface SharedRootEntry {
  path: string;
  updatedAt: string;
}

interface SharedRootsFile {
  roots: SharedRootEntry[];
}

/**
 * Absolute path of the hint file, or `null` when the platform gives us nowhere
 * to put it. `LOCALAPPDATA` is per-user and identifier-free, which is exactly the
 * scope wanted: the same user's builds share it, another user's do not.
 */
export function sharedModelRootsFile(env: NodeJS.ProcessEnv = process.env): string | null {
  const local = env.LOCALAPPDATA?.trim();
  if (local) return path.join(local, SHARED_DIRECTORY, SHARED_MODEL_ROOTS_FILE);
  const home = env.HOME?.trim();
  if (home) {
    return path.join(home, 'Library', 'Application Support', SHARED_DIRECTORY, SHARED_MODEL_ROOTS_FILE);
  }
  return null;
}

/**
 * Roots recorded by this or another build, newest first, with entries whose
 * directory has since disappeared filtered out (an unplugged drive must not make
 * the lookup walk a path that cannot answer).
 */
export function readSharedModelRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const file = sharedModelRootsFile(env);
  if (!file) return [];
  return readEntries(file)
    .map((entry) => entry.path)
    .filter((root) => existsSync(root));
}

/**
 * Records `root` as a place models live, newest first.
 *
 * Called whenever a download root becomes official (see
 * `provisioningStore.writeProvisioningState`) and once per server start for a
 * state that predates this file, so an existing model cache is picked up without
 * the user repeating the wizard.
 */
export async function publishSharedModelRoot(
  root: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const target = root.trim();
  const file = sharedModelRootsFile(env);
  if (!target || !file) return;

  const resolved = path.resolve(target);
  const kept = readEntries(file).filter((entry) => !samePath(entry.path, resolved) && existsSync(entry.path));
  const next: SharedRootsFile = {
    roots: [{ path: resolved, updatedAt: new Date().toISOString() }, ...kept].slice(
      0,
      SHARED_MODEL_ROOTS_LIMIT
    )
  };

  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.warn(`[provisioning] 无法写入共享模型目录记录（${file}）：`, error);
  }
}

function readEntries(file: string): SharedRootEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<SharedRootsFile>;
    if (!Array.isArray(parsed.roots)) return [];
    return parsed.roots
      .filter(
        (entry): entry is SharedRootEntry => typeof entry?.path === 'string' && entry.path.trim() !== ''
      )
      .map((entry) => ({
        path: entry.path,
        updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : ''
      }));
  } catch {
    // Absent or unreadable: no shared roots, which is the state before the first
    // publish. Never a reason to fail a request.
    return [];
  }
}

/** Windows paths are case-insensitive; spelling differences are not a new root. */
function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  return process.platform === 'win32'
    ? a.toLowerCase() === path.resolve(right).toLowerCase()
    : a === path.resolve(right);
}
