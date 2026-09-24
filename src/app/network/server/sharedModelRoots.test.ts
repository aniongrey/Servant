import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  publishSharedModelRoot,
  readSharedModelRoots,
  sharedModelRootsFile,
  SHARED_MODEL_ROOTS_FILE,
  SHARED_MODEL_ROOTS_LIMIT
} from './sharedModelRoots.ts';

describe('shared model roots', () => {
  let local: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    local = await mkdtemp(join(tmpdir(), 'servant-local-'));
    env = { LOCALAPPDATA: local };
  });

  afterEach(async () => {
    await rm(local, { recursive: true, force: true });
  });

  it('records the file under the local app data root, not next to the app', () => {
    expect(sharedModelRootsFile(env)).toBe(join(local, 'Servant', SHARED_MODEL_ROOTS_FILE));
  });

  it('has nowhere to write when the platform gives no local app data', () => {
    expect(sharedModelRootsFile({})).toBeNull();
    // Publishing without a target is a no-op, not a crash.
    return expect(publishSharedModelRoot('E:/irrelevant', {})).resolves.toBeUndefined();
  });

  it('round-trips a published root and ignores one whose directory is gone', async () => {
    const alive = await mkdtemp(join(tmpdir(), 'servant-models-'));
    const gone = join(tmpdir(), 'servant-not-there-1234');

    await publishSharedModelRoot(gone, env);
    await publishSharedModelRoot(alive, env);

    // Newest first, and only what can still answer a lookup.
    expect(readSharedModelRoots(env)).toEqual([alive]);
    await rm(alive, { recursive: true, force: true });
  });

  it('keeps the newest entry for a root that is re-published', async () => {
    const root = await mkdtemp(join(tmpdir(), 'servant-models-'));
    await publishSharedModelRoot(root, env);
    await publishSharedModelRoot(`${root}${path.sep}`, env);

    expect(readSharedModelRoots(env)).toEqual([root]);
    const file = sharedModelRootsFile(env)!;
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { roots: { path: string }[] };
    expect(parsed.roots).toHaveLength(1);
    await rm(root, { recursive: true, force: true });
  });

  it('drops the oldest roots past the limit', async () => {
    const roots: string[] = [];
    for (let index = 0; index <= SHARED_MODEL_ROOTS_LIMIT; index += 1) {
      const root = await mkdtemp(join(tmpdir(), `servant-models-${index}-`));
      roots.push(root);
      await publishSharedModelRoot(root, env);
    }

    const kept = readSharedModelRoots(env);
    expect(kept).toHaveLength(SHARED_MODEL_ROOTS_LIMIT);
    expect(kept[0]).toBe(roots[roots.length - 1]);
    expect(kept).not.toContain(roots[0]);
    for (const root of roots) await rm(root, { recursive: true, force: true });
  });

  it('survives a corrupt file instead of failing every lookup', async () => {
    const file = sharedModelRootsFile(env)!;
    await mkdir(join(local, 'Servant'), { recursive: true });
    await writeFile(file, '{ not json', 'utf8');

    expect(readSharedModelRoots(env)).toEqual([]);
    expect(existsSync(file)).toBe(true);
    const root = await mkdtemp(join(tmpdir(), 'servant-models-'));
    await publishSharedModelRoot(root, env);
    expect(readSharedModelRoots(env)).toEqual([root]);
    await rm(root, { recursive: true, force: true });
  });
});
