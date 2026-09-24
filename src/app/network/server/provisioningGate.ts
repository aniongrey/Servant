/**
 * The first-run gate: does Shiro still have something to prepare?
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
 *     setupRequired = 没有完成过初始化  &&  至少一个资源既不在所选目录、也不在
 *                     任何运行时会读的位置（镜像 / 共享模型根）
 *
 * "完成过一次" still wins outright: a user who deliberately skipped the speech
 * model during setup must not be asked again at every launch. The disk check
 * exists for the other direction — models that are already there, for a build
 * that has never run the wizard.
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
  /** Directory downloads would go to right now. */
  downloadRoot: string;
  /** Roots published by other Shiro builds on this machine, newest first. */
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

  return {
    setupRequired: !state.setupComplete && resources.some((resource) => resource.presence === 'absent'),
    setupComplete: state.setupComplete,
    downloadRoot,
    sharedRoots,
    resources
  };
}
