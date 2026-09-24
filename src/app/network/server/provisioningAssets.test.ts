import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  contentTypeOf,
  resolveResourceAsset,
  safeRelativeSegments
} from './provisioningAssets.ts';

describe('safeRelativeSegments', () => {
  it('accepts ordinary nested paths', () => {
    expect(safeRelativeSegments('model.int8.onnx')).toEqual(['model.int8.onnx']);
    expect(safeRelativeSegments('1_Pooling/config.json')).toEqual(['1_Pooling', 'config.json']);
  });

  it('rejects anything that could escape a root', () => {
    expect(safeRelativeSegments('../secret')).toBeNull();
    expect(safeRelativeSegments('a/../../b')).toBeNull();
    expect(safeRelativeSegments('a//b')).toBeNull();
    expect(safeRelativeSegments('a\\b')).toBeNull();
    expect(safeRelativeSegments('')).toBeNull();
  });
});

describe('contentTypeOf', () => {
  it('labels model weights and text files', () => {
    expect(contentTypeOf('/x/model.int8.onnx')).toBe('application/octet-stream');
    expect(contentTypeOf('/x/tokens.txt')).toBe('text/plain; charset=utf-8');
    expect(contentTypeOf('/x/unknown.weird')).toBe('application/octet-stream');
  });
});

describe('resolveResourceAsset', () => {
  let workDir: string;
  let roots: string[];

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'shiro-assets-'));
    const download = join(workDir, 'download');
    const mirror = join(workDir, 'mirror');
    await mkdir(download, { recursive: true });
    await mkdir(join(mirror, 'nested'), { recursive: true });
    // Same file in both roots, with different content: which one answers is the
    // whole point of the ordering rule.
    await writeFile(join(download, 'model.int8.onnx'), 'DOWNLOAD');
    await writeFile(join(mirror, 'model.int8.onnx'), 'MIRROR');
    await writeFile(join(mirror, 'nested', 'tokens.txt'), 'MIRROR-ONLY');
    await writeFile(join(workDir, 'outside.txt'), 'SECRET');
    roots = [download, mirror];
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('prefers the download root over a mirror', async () => {
    const asset = resolveResourceAsset(roots, 'model.int8.onnx');
    expect(asset?.root).toBe(roots[0]);
    expect(asset?.sizeBytes).toBe('DOWNLOAD'.length);
  });

  it('falls back to a mirror for files only the bundle carries', () => {
    const asset = resolveResourceAsset(roots, 'nested/tokens.txt');
    expect(asset?.root).toBe(roots[1]);
    expect(asset?.contentType).toBe('text/plain; charset=utf-8');
  });

  it('returns null when no root has the file', () => {
    expect(resolveResourceAsset(roots, 'missing.onnx')).toBeNull();
  });

  it('never serves a file outside the roots', () => {
    expect(resolveResourceAsset(roots, '../outside.txt')).toBeNull();
    expect(resolveResourceAsset(roots, 'nested/../../outside.txt')).toBeNull();
  });
});
