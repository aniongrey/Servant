import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanGptSovitsModels } from './gptSovitsScanner.ts';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'gs-scan-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function touch(relative: string): void {
  const absolute = path.join(root, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, '');
}

describe('scanGptSovitsModels', () => {
  it('finds weights in the official GPT-SoVITS layout', () => {
    touch('GPT_weights/my-gpt-e15.ckpt');
    touch('GPT_weights/paired-v1.pth'); // extension, not folder name, decides the kind
    touch('SoVITS_weights/my-sovits-e15.pth');
    touch('GPT_SoVITS/pretrained_models/s1bert25hz-2kh-longer-epoch=68e-step=50232.ckpt');
    touch('GPT_SoVITS/pretrained_models/s2G488k.pth');

    const result = scanGptSovitsModels(root);
    expect(result.error).toBeUndefined();
    expect(result.missing).toEqual([]);
    expect(result.gpt.map((entry) => entry.label)).toEqual([
      's1bert25hz-2kh-longer-epoch=68e-step=50232.ckpt',
      'GPT_weights/my-gpt-e15.ckpt'
    ]);
    expect(result.sovits.map((entry) => entry.label)).toEqual([
      's2G488k.pth',
      'GPT_weights/paired-v1.pth',
      'SoVITS_weights/my-sovits-e15.pth'
    ]);
  });

  it('treats every root child starting with GPT/SoVITS as a weight container, one level deep', () => {
    touch('GPT_weights_v2Pro/my-gpt-e15.ckpt');
    touch('SoVITS_weights_v2Pro/my-sovits_e15.pth');
    touch('GPT_outputs/renamed.ckpt'); // a renamed container still counts
    touch('sovits_custom/renamed.pth'); // prefix matching is case-insensitive

    const result = scanGptSovitsModels(root);
    expect(result.gpt.map((entry) => `${entry.version}:${entry.label}`)).toEqual([
      'v2Pro:GPT_weights_v2Pro/my-gpt-e15.ckpt',
      '其它:GPT_outputs/renamed.ckpt'
    ]);
    expect(result.sovits.map((entry) => `${entry.version}:${entry.label}`)).toEqual([
      'v2Pro:SoVITS_weights_v2Pro/my-sovits_e15.pth',
      '其它:sovits_custom/renamed.pth'
    ]);
    expect(result.missing).toEqual([]);
  });

  it('never reads below the container level and drops training artifacts', () => {
    touch('GPT_weights_v2Pro/nested/deep.ckpt'); // one level only — sub-directory is ignored
    touch('outputs/my-gpt-e15.ckpt'); // no GPT*/SoVITS* container, so no deep fallback walk
    touch('GPT_weights_v2Pro/s2D1234.pth'); // discriminator — filtered
    touch('GPT_weights_v2Pro/vocoder.pth'); // vocoder — filtered

    const result = scanGptSovitsModels(root);
    expect(result.gpt).toEqual([]);
    expect(result.sovits).toEqual([]);
    // The GPT* container was found (it is just empty of usable weights); only the
    // genuinely absent prefix is reported.
    expect(result.missing).toEqual(['SoVITS*']);
  });

  it('reports the missing container prefix instead of guessing', () => {
    touch('GPT_weights/my-gpt-e15.ckpt');
    expect(scanGptSovitsModels(root).missing).toEqual(['SoVITS*']);

    // An empty sub-folder of an install resolves upwards — same repo, so that is
    // a correction, not a guess.
    const inside = path.join(root, 'not-an-install');
    mkdirSync(inside, { recursive: true });
    expect(scanGptSovitsModels(inside).scanRoot).toBe(root);

    // With no install anywhere near it, the result stays empty and names both
    // absent prefixes rather than walking the disk.
    const isolated = mkdtempSync(path.join(tmpdir(), 'gs-lone-'));
    try {
      const lone = scanGptSovitsModels(isolated);
      expect(lone.scanRoot).toBeUndefined();
      expect(lone.missing).toEqual(['GPT*', 'SoVITS*']);
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  it('reports a friendly error for an unset or missing root', () => {
    expect(scanGptSovitsModels('').error).toBe('尚未设置安装目录');
    const missing = mkdtempSync(path.join(tmpdir(), 'gs-missing-'));
    rmSync(missing, { recursive: true, force: true });
    expect(scanGptSovitsModels(missing).error).toBe('安装目录不存在');
  });

  it('corrects an off-by-one install root instead of scanning nothing', () => {
    const repo = path.join(root, 'outer', 'repo');
    touch('outer/repo/GPT_weights_v2ProPlus/trained-e5.ckpt');
    touch('outer/repo/SoVITS_weights_v2ProPlus/trained_e4.pth');
    // The inner `GPT_SoVITS` exists but holds no weights of its own.
    mkdirSync(path.join(repo, 'GPT_SoVITS'), { recursive: true });

    const labels = (result: ReturnType<typeof scanGptSovitsModels>) => ({
      gpt: result.gpt.map((entry) => entry.label),
      sovits: result.sovits.map((entry) => entry.label)
    });
    const expected = {
      gpt: ['GPT_weights_v2ProPlus/trained-e5.ckpt'],
      sovits: ['SoVITS_weights_v2ProPlus/trained_e4.pth']
    };

    // Pointing at the inner `GPT_SoVITS`, at one weight folder, or at the folder
    // that contains the repo all resolve to the repo root.
    for (const typed of [
      path.join(repo, 'GPT_SoVITS'),
      path.join(repo, 'GPT_weights_v2ProPlus'),
      path.join(root, 'outer')
    ]) {
      const result = scanGptSovitsModels(typed);
      expect(labels(result)).toEqual(expected);
      expect(result.scanRoot).toBe(repo);
    }
  });

  it('does not relocate a root that already yields weights, nor guess between siblings', () => {
    touch('repo/GPT_weights/my-gpt-e15.ckpt');
    const typed = path.join(root, 'repo');
    const direct = scanGptSovitsModels(typed);
    expect(direct.scanRoot).toBeUndefined();
    expect(direct.gpt.map((entry) => entry.label)).toEqual(['GPT_weights/my-gpt-e15.ckpt']);

    // Two children that both look like an install: too ambiguous to pick one.
    const ambiguous = mkdtempSync(path.join(tmpdir(), 'gs-amb-'));
    try {
      for (const relative of ['a/GPT_weights/x.ckpt', 'b/SoVITS_weights/y.pth']) {
        const absolute = path.join(ambiguous, relative);
        mkdirSync(path.dirname(absolute), { recursive: true });
        writeFileSync(absolute, '');
      }
      const result = scanGptSovitsModels(ambiguous);
      expect(result.scanRoot).toBeUndefined();
      expect(result.gpt).toEqual([]);
      expect(result.sovits).toEqual([]);
    } finally {
      rmSync(ambiguous, { recursive: true, force: true });
    }
  });
});
