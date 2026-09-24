import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createGptSovitsStore, normalizeGptSovitsProfile } from './gptSovitsStore';
import { DEFAULT_GPT_SOVITS_SETTINGS } from '../../gptSovitsContract';

describe('gptSovitsStore', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'servant-gptsovits-'));
  });

  it('seeds a default role so a fresh install can speak immediately', async () => {
    const store = createGptSovitsStore({ dataDir });
    await store.ready();
    const profiles = store.listProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe('默认角色');
    expect(profiles[0].settings).toEqual(DEFAULT_GPT_SOVITS_SETTINGS);
  });

  it('keeps role ids and reloads them from disk', async () => {
    const store = createGptSovitsStore({ dataDir });
    await store.ready();
    const saved = await store.upsertProfile({ name: '白瓜', models: { gpt: 'g.ckpt' } });
    await store.setRoot('F:/GPT-SoVITS');
    await store.setLoaded('g.ckpt', 's.pth');

    const reloaded = createGptSovitsStore({ dataDir });
    await reloaded.ready();
    expect(reloaded.getRoot()).toBe('F:/GPT-SoVITS');
    expect(reloaded.getLoaded()).toEqual({ gpt: 'g.ckpt', sovits: 's.pth' });
    expect(reloaded.getProfile(saved.id)?.name).toBe('白瓜');
  });

  it('never overwrites an existing role when importing', async () => {
    const store = createGptSovitsStore({ dataDir });
    await store.ready();
    const original = await store.upsertProfile({ name: '白瓜' });
    const imported = await store.importProfile({ id: original.id, name: '白瓜' });

    expect(imported.id).not.toBe(original.id);
    expect(imported.name).toBe('白瓜 (2)');
    expect(store.getProfile(original.id)?.name).toBe('白瓜');
  });

  it('refuses to delete the last role', async () => {
    const store = createGptSovitsStore({ dataDir });
    await store.ready();
    const only = store.listProfiles()[0];
    await expect(store.deleteProfile(only.id)).rejects.toThrow(/至少保留一个角色/);
  });

  it('writes valid JSON even for hostile input', async () => {
    const store = createGptSovitsStore({ dataDir });
    await store.ready();
    await store.upsertProfile({
      name: null,
      models: { gpt: 42 },
      references: { neutral: { audio: 7 }, unknownEmotion: { audio: 'a.wav' } },
      settings: { speed_factor: 'fast' }
    });
    const onDisk = JSON.parse(readFileSync(path.join(dataDir, 'studio.json'), 'utf8'));
    const normalized = normalizeGptSovitsProfile(onDisk.profiles.at(-1));
    expect(normalized.name).toBe('未命名角色');
    expect(normalized.models.gpt).toBe('');
    expect(normalized.references.neutral.audio).toBe('');
    expect(Object.keys(normalized.references)).not.toContain('unknownEmotion');
  });
});
