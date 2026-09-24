/**
 * "Is this resource actually on disk?" — the question the first-run gate needs
 * answered, and the one the panel shows.
 *
 * Two different questions hide behind it, and conflating them is what made a
 * machine with 1.4 GB of downloaded models open the setup wizard on every launch:
 *
 * - **ready** — a completion marker in *the chosen download root*: the pull ran
 *   here, to the end. This is what the panel's "已就绪" means, and the only state
 *   that lets the panel stop offering the download.
 * - **usable** — the files the runtime loads are present in some directory it
 *   reads. A copy that predates the marker, one the user copied in, or one
 *   another Servant build downloaded to a shared root is usable; asking the user to
 *   fetch it again would be pure ceremony, so the gate accepts it.
 *
 * A half-download is neither: `requiredFiles` is checked file by file, so a
 * directory holding `model.int8.onnx` without `tokens.txt` stays absent and the
 * user is asked for the rest.
 */

import { statSync } from 'node:fs';
import path from 'node:path';
import { readModelRepoMarker, type RepoMarker } from './modelRepository.ts';
import type { ResourceManifestEntry } from './resourceManifest.ts';

export type ResourcePresence = 'ready' | 'usable' | 'absent';

export interface ResourceLocation {
  state: ResourcePresence;
  /** Directory that answered, for `ready` and `usable` alike. */
  directory?: string;
  /** Completion marker, present only for `ready` — callers showing file counts use it. */
  marker?: RepoMarker;
}

/**
 * Locates a resource across `roots` (the order `resourceRoots()` returns).
 *
 * The marker is only consulted in `roots[0]` — the chosen download root — so
 * "ready" keeps meaning what it always meant and a mirror can never claim it.
 */
export async function locateResource(
  roots: readonly string[],
  entry: ResourceManifestEntry
): Promise<ResourceLocation> {
  const chosen = roots[0];
  if (!chosen) return { state: 'absent' };
  const marker = await readModelRepoMarker(chosen);
  if (marker) return { state: 'ready', directory: chosen, marker };
  for (const root of roots) {
    if (entry.requiredFiles.every((file) => isFile(path.join(root, file)))) {
      return { state: 'usable', directory: root };
    }
  }
  return { state: 'absent' };
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}
