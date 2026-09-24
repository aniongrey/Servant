import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { locateResource } from './resourcePresence.ts';
import { getResourceEntry } from './resourceManifest.ts';
import { REPO_MARKER_FILE } from './modelRepository.ts';
import { STT_MODEL_RESOURCE_ID } from '../../provisioning/provisioningTypes.ts';

const stt = getResourceEntry(STT_MODEL_RESOURCE_ID)!;

/** Writes the files a working copy has, without a completion marker. */
async function writeUsableFiles(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  for (const file of stt.requiredFiles) await writeFile(join(directory, file), 'x');
}

describe('resource presence', () => {
  let work: string;
  const roots = (...names: string[]): string[] => names.map((name) => join(work, name));

  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), 'servant-presence-'));
  });

  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  it('reports absent when nothing is on disk', async () => {
    expect(await locateResource(roots('chosen', 'mirror'), stt)).toEqual({ state: 'absent' });
  });

  it('reports ready only for a completed pull in the chosen root', async () => {
    await writeUsableFiles(join(work, 'chosen'));
    await writeFile(
      join(work, 'chosen', REPO_MARKER_FILE),
      JSON.stringify({ repo: 'x/y', files: [{ path: 'tokens.txt', sizeBytes: 1 }] }),
      'utf8'
    );

    const located = await locateResource(roots('chosen', 'mirror'), stt);
    expect(located.state).toBe('ready');
    expect(located.directory).toBe(join(work, 'chosen'));
    expect(located.marker?.repo).toBe('x/y');
  });

  it('accepts a copy that has the files but no marker, wherever it lives', async () => {
    await writeUsableFiles(join(work, 'mirror'));

    const located = await locateResource(roots('chosen', 'mirror'), stt);
    expect(located.state).toBe('usable');
    expect(located.directory).toBe(join(work, 'mirror'));
    expect(located.marker).toBeUndefined();
  });

  it('rejects a half-download: the files the runtime loads must all be there', async () => {
    await mkdir(join(work, 'mirror'), { recursive: true });
    // The big weights made it; the token table did not.
    await writeFile(join(work, 'mirror', stt.requiredFiles[0]), 'x');

    expect(await locateResource(roots('chosen', 'mirror'), stt)).toEqual({ state: 'absent' });
  });

  it('answers with the first lookup root that has the files', async () => {
    await writeUsableFiles(join(work, 'chosen'));
    await writeUsableFiles(join(work, 'mirror'));

    expect(await locateResource(roots('chosen', 'mirror'), stt)).toMatchObject({
      state: 'usable',
      directory: join(work, 'chosen')
    });
  });
});
