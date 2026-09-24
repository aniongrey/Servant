import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Where the backend reads source assets from and where it may write mutable
 * configuration.
 *
 * Development (Vite or the standalone `servant-server` run from the repo): both
 * roots are the repository, so behaviour is byte-identical to the previous
 * middleware-only setup.
 *
 * Packaged (Tauri sidecar): `root` is the app's read-only resource directory and
 * `data` is the per-user app data directory. Rust passes both through the
 * `SERVANT_PROJECT_ROOT` / `SERVANT_DATA_DIR` environment variables.
 */
export interface ProjectPaths {
  /** Read-only source root. */
  root: string;
  /** Writable root for mutable configuration and caches. */
  data: string;
}

export function resolveProjectPaths(env: NodeJS.ProcessEnv = process.env): ProjectPaths {
  const root = path.resolve(env.SERVANT_PROJECT_ROOT?.trim() || process.cwd());
  return { root, data: path.resolve(env.SERVANT_DATA_DIR?.trim() || root) };
}

/** Absolute path of a read-only project asset. */
export function readOnlyFile(paths: ProjectPaths, relative: string): string {
  return path.resolve(paths.root, relative);
}

/**
 * Absolute path of a mutable project file. In a packaged app this lives under
 * the writable root; in development it is the file in the source tree.
 */
export function mutableFile(paths: ProjectPaths, relative: string): string {
  return path.resolve(paths.data, relative);
}

/**
 * Reads a mutable project file, seeding the writable copy from the read-only
 * source root the first time it is requested. Throws whatever the last read
 * threw when the file exists in neither root.
 */
export async function readMutableFile(paths: ProjectPaths, relative: string): Promise<string> {
  const target = mutableFile(paths, relative);
  const source = readOnlyFile(paths, relative);
  try {
    return await readFile(target, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || target === source) throw error;
  }
  const seeded = await readFile(source, 'utf8');
  await writeMutableFile(paths, relative, seeded);
  return seeded;
}

/** Writes a mutable project file, creating parent directories as needed. */
export async function writeMutableFile(
  paths: ProjectPaths,
  relative: string,
  content: string
): Promise<void> {
  const target = mutableFile(paths, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

/** True when the read-only source root actually carries this asset. */
export function hasReadOnlyFile(paths: ProjectPaths, relative: string): boolean {
  return existsSync(readOnlyFile(paths, relative));
}
