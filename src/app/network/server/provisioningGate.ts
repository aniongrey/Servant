/**
 * The first-run gate: does Servant still have something to prepare?
 *
 * This used to live in Rust (`desktop_windows.rs`), reading `setupComplete` out of
 * the state file — but that file only ever records that the *wizard* was finished,
 * in *that* build's data directory. A machine whose models are demonstrably on
 * disk (or whose state file was never written, because the checkout and the
 * packaged app keep separate ones) was sent through setup on every launch.
 *
 * The gate therefore answers with the disk's opinion, and it is computed here
 * because this is the only side that knows the resource manifest:
 *
 *     setupRequired = 至少一个「本该在这里」的资源，既不在所选目录、也不在任何
 *                     运行时会读的位置（镜像 / 共享模型根）
 *
 * "本该在这里" is the whole subtlety. A resource is expected when either
 *
 * - the wizard has never been finished in this build (`!setupComplete`) — the old
 *   rule, which is what a fresh install answers, or
 * - **the wizard recorded preparing it** (`preparedResources`).
 *
 * The second clause is the repair for a gate that lied in the other direction. It
 * used to let `setupComplete` veto everything, so a machine whose prepared model
 * had since been deleted, moved, or downloaded under an older download root got
 * no wizard and no way to ask for one — the runtime went without its model while
 * the panel that could fetch it promised "nothing to prepare". A record of
 * having downloaded something is exactly the thing that can go stale, and the
 * disk's answer is the one that stays true.
 *
 * The promise to the *skipped* resource is preserved: something the user chose
 * not to download is not in `preparedResources`, so it never opens the wizard.
 * Finishing the wizard again rewrites that list, which is also the escape hatch
 * for the case above — skip it once and the gate stops asking.
 */

import type { ProjectPaths } from './projectPaths.ts';
import { readProvisioningStateSync, resourceRoots } from './provisioningStore.ts';
import { readSharedModelRoots } from './sharedModelRoots.ts';
import { RESOURCE_MANIFEST } from './resourceManifest.ts';
import { locateResource, type ResourcePresence } from './resourcePresence.ts';

export interface GateResource {
  id: string;
  label: string;
  presence: ResourcePresence;
  /** Directory that answered, when one did. */
  directory?: string;
}

export interface SetupGate {
  /** True when the setup window should be opened instead of the chat window. */
  setupRequired: boolean;
  /** The persisted "the user finished setup once" flag, for diagnostics. */
  setupComplete: boolean;
  /** Ids the wizard recorded as prepared; missing ones are what re-opens the panel. */
  preparedResources: string[];
  /** Directory downloads would go to right now. */
  downloadRoot: string;
  /** Roots published by other Servant builds on this machine, newest first. */
  sharedRoots: string[];
  resources: GateResource[];
}

export async function evaluateSetupGate(
  paths: ProjectPaths,
  env: NodeJS.ProcessEnv = process.env
): Promise<SetupGate> {
  const state = readProvisioningStateSync(paths);
  const sharedRoots = readSharedModelRoots(env);
  const downloadRoot = state.downloadRoot.trim();

  const resources: GateResource[] = [];
  for (const entry of RESOURCE_MANIFEST) {
    const located = await locateResource(resourceRoots(paths, entry, undefined, sharedRoots), entry);
    resources.push({
      id: entry.id,
      label: entry.label,
      presence: located.state,
      ...(located.directory ? { directory: located.directory } : {})
    });
  }

  // "Should be here": the wizard either prepared it, or never ran in this build.
  // A resource the user deliberately skipped at setup is neither, so it never
  // opens the wizard on its own.
  const prepared = new Set(state.preparedResources);
  const expectedHere = (id: string): boolean => !state.setupComplete || prepared.has(id);

  return {
    setupRequired: resources.some((resource) => resource.presence === 'absent' && expectedHere(resource.id)),
    setupComplete: state.setupComplete,
    preparedResources: state.preparedResources,
    downloadRoot,
    sharedRoots,
    resources
  };
}
