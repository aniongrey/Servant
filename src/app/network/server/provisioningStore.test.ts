import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  defaultDownloadRoot,
  downloadRootOf,
  downloadRootProblem,
  readProvisioningStateSync,
  resourceRoots
} from './provisioningStore.ts';
import { getResourceEntry } from './resourceManifest.ts';
import {
  MEMORY_MODEL_RESOURCE_ID,
  PROVISIONING_STATE_FILE,
  STT_MODEL_RESOURCE_ID
} from '../../provisioning/provisioningTypes.ts';

describe('download root resolution', () => {
  let root: string;
  let data: string;
  const paths = () => ({ root, data });

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'shiro-root-'));
    data = await mkdtemp(join(tmpdir(), 'shiro-data-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(data, { recursive: true, force: true });
  });

  it('defaults to a models folder beside the app', () => {
    expect(defaultDownloadRoot(paths())).toBe(join(root, 'models'));
    expect(downloadRootOf(paths())).toBe(join(root, 'models'));
  });

  it('honours the directory the user chose', async () => {
    const chosen = join(root, 'D-drive-models');
    await writeFile(
      join(data, PROVISIONING_STATE_FILE),
      JSON.stringify({ downloadRoot: chosen }),
      'utf8'
    );
    expect(readProvisioningStateSync(paths()).downloadRoot).toBe(chosen);
    expect(downloadRootOf(paths())).toBe(chosen);
  });

  it('survives a corrupt state file by falling back to the default', async () => {
    await writeFile(join(data, PROVISIONING_STATE_FILE), '{ not json', 'utf8');
    expect(downloadRootOf(paths())).toBe(join(root, 'models'));
  });

  it('orders the download root before the manifest mirrors', () => {
    const stt = getResourceEntry(STT_MODEL_RESOURCE_ID);
    const memory = getResourceEntry(MEMORY_MODEL_RESOURCE_ID);
    expect(stt && memory).toBeTruthy();

    // STT: downloaded copy first, the bundled *runtime* second (it carries the
    // VAD exports the repository does not ship — never the model itself).
    expect(resourceRoots(paths(), stt!, join(root, 'chosen'))).toEqual([
      join(root, 'chosen', 'sherpa-asr'),
      join(root, 'public', 'engines', 'sensevoice')
    ]);

    // Memory: downloaded copy first, the pre-existing data-directory copy second.
    expect(resourceRoots(paths(), memory!, join(root, 'chosen'))).toEqual([
      join(root, 'chosen', 'Qwen3-Embedding-0.6B'),
      join(data, '.local', 'models', 'Qwen3-Embedding-0.6B')
    ]);
  });
});

describe('downloadRootProblem', () => {
  let workDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'shiro-writable-'));
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('accepts a creatable directory and leaves no probe behind', async () => {
    const target = join(workDir, 'nested', 'models');
    expect(downloadRootProblem(target)).toBeNull();
    expect(await readdir(target)).toEqual([]);
  });

  it('reports a path that cannot be a directory instead of blaming the network', async () => {
    const file = join(workDir, 'not-a-directory');
    await writeFile(file, 'x', 'utf8');
    // Windows answers EEXIST, POSIX ENOTDIR; either way the caller must get a
    // sentence about the directory, not a download failure.
    expect(downloadRootProblem(file)).toMatch(/无法创建|不可写/);
  });
});
