import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { evaluateSetupGate } from './provisioningGate.ts';
import { RESOURCE_MANIFEST } from './resourceManifest.ts';
import { publishSharedModelRoot } from './sharedModelRoots.ts';
import type { ProjectPaths } from './projectPaths.ts';
import { PROVISIONING_STATE_FILE } from '../../provisioning/provisioningTypes.ts';

/**
 * The rule under test, in one line: the setup window is for machines that are
 * missing something they are supposed to have — not for machines whose models are
 * already somewhere Servant reads, and not for models the user chose to skip.
 */
describe('first-run gate', () => {
  let root: string;
  let data: string;
  let local: string;
  let env: NodeJS.ProcessEnv;
  const paths = (): ProjectPaths => ({ root, data });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'servant-gate-root-'));
    data = await mkdtemp(join(tmpdir(), 'servant-gate-data-'));
    local = await mkdtemp(join(tmpdir(), 'servant-gate-local-'));
    env = { LOCALAPPDATA: local };
  });

  afterEach(async () => {
    for (const directory of [root, data, local]) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  /** Populates a download-root-shaped directory with a usable copy of every resource. */
  async function fillDownloadRoot(directory: string): Promise<void> {
    for (const entry of RESOURCE_MANIFEST) {
      const resourceDirectory = join(directory, entry.relative);
      await mkdir(resourceDirectory, { recursive: true });
      for (const file of entry.requiredFiles) {
        await writeFile(join(resourceDirectory, file), 'x');
      }
    }
  }

  async function persistState(state: Record<string, unknown>): Promise<void> {
    await writeFile(join(data, PROVISIONING_STATE_FILE), JSON.stringify(state), 'utf8');
  }

  it('asks for setup on a machine where nothing was ever downloaded', async () => {
    const gate = await evaluateSetupGate(paths(), env);
    expect(gate.setupRequired).toBe(true);
    expect(gate.resources.every((resource) => resource.presence === 'absent')).toBe(true);
  });

  it('skips setup when the models already sit in the chosen download root', async () => {
    const chosen = await mkdtemp(join(tmpdir(), 'servant-gate-chosen-'));
    await fillDownloadRoot(chosen);
    await persistState({ downloadRoot: chosen });

    const gate = await evaluateSetupGate(paths(), env);
    expect(gate.setupRequired).toBe(false);
    expect(gate.resources.every((resource) => resource.presence === 'usable')).toBe(true);
    await rm(chosen, { recursive: true, force: true });
  });

  it('skips setup when another build on this machine recorded the download root', async () => {
    // The case that motivated this: the checkout and the packaged app keep
    // separate state files, so only the shared roots file can connect them.
    const shared = await mkdtemp(join(tmpdir(), 'servant-gate-shared-'));
    await fillDownloadRoot(shared);
    await publishSharedModelRoot(shared, env);

    const gate = await evaluateSetupGate(paths(), env);
    expect(gate.setupRequired).toBe(false);
    expect(gate.sharedRoots).toEqual([shared]);
    expect(gate.resources[0].directory?.startsWith(shared)).toBe(true);
    await rm(shared, { recursive: true, force: true });
  });

  it('still asks when only some of the resources are on disk', async () => {
    const shared = await mkdtemp(join(tmpdir(), 'servant-gate-partial-'));
    const [first] = RESOURCE_MANIFEST;
    const resourceDirectory = join(shared, first.relative);
    await mkdir(resourceDirectory, { recursive: true });
    for (const file of first.requiredFiles) await writeFile(join(resourceDirectory, file), 'x');
    await publishSharedModelRoot(shared, env);

    const gate = await evaluateSetupGate(paths(), env);
    expect(gate.setupRequired).toBe(true);
    expect(gate.resources.map((resource) => resource.presence)).toEqual(['usable', 'absent']);
    await rm(shared, { recursive: true, force: true });
  });

  it('never asks again for a model the user chose to skip', async () => {
    // A user who deliberately skipped a model must not be asked on every launch.
    // Skipping is recorded by *not* listing the resource in `preparedResources`,
    // so an empty list means "setup ran, and there is nothing of mine on disk".
    await persistState({ setupComplete: true, downloadRoot: '', preparedResources: [] });

    const gate = await evaluateSetupGate(paths(), env);
    expect(gate.setupRequired).toBe(false);
    expect(gate.setupComplete).toBe(true);
  });

  it('asks again when a resource the wizard prepared is no longer anywhere it reads', async () => {
    // The other direction of the same flag: `setupComplete` says the wizard ran,
    // and the wizard's own list says it fetched the speech model — but the model
    // is gone (deleted, moved, or left behind in an older download root). Without
    // this the runtime quietly loses speech recognition and no panel ever offers
    // to bring the file back.
    const [speech] = RESOURCE_MANIFEST;
    await persistState({
      setupComplete: true,
      downloadRoot: '',
      preparedResources: [speech.id]
    });

    const gate = await evaluateSetupGate(paths(), env);
    expect(gate.setupRequired).toBe(true);
    expect(gate.resources.map((resource) => resource.presence)).toEqual(['absent', 'absent']);
    expect(gate.preparedResources).toEqual([speech.id]);
  });

  it('stays quiet when everything the wizard prepared is still readable', async () => {
    const [speech] = RESOURCE_MANIFEST;
    const chosen = await mkdtemp(join(tmpdir(), 'servant-gate-prepared-'));
    const resourceDirectory = join(chosen, speech.relative);
    await mkdir(resourceDirectory, { recursive: true });
    for (const file of speech.requiredFiles) await writeFile(join(resourceDirectory, file), 'x');
    await persistState({
      setupComplete: true,
      downloadRoot: chosen,
      preparedResources: [speech.id]
    });

    const gate = await evaluateSetupGate(paths(), env);
    expect(gate.setupRequired).toBe(false);
    expect(gate.resources[0].presence).toBe('usable');
    await rm(chosen, { recursive: true, force: true });
  });

  it('asks for the lost resource without mistaking the readable one for missing', async () => {
    // Both halves at once: the memory model is on disk through a shared root (so
    // it must not be what asks), while the prepared speech model has vanished.
    const [speech, memory] = RESOURCE_MANIFEST;
    const shared = await mkdtemp(join(tmpdir(), 'servant-gate-half-'));
    const memoryDirectory = join(shared, memory.relative);
    await mkdir(memoryDirectory, { recursive: true });
    for (const file of memory.requiredFiles) await writeFile(join(memoryDirectory, file), 'x');
    await publishSharedModelRoot(shared, env);
    await persistState({
      setupComplete: true,
      downloadRoot: '',
      preparedResources: [speech.id, memory.id]
    });

    const gate = await evaluateSetupGate(paths(), env);
    expect(gate.setupRequired).toBe(true);
    expect(gate.resources.map((resource) => resource.presence)).toEqual(['absent', 'usable']);
    await rm(shared, { recursive: true, force: true });
  });
});
