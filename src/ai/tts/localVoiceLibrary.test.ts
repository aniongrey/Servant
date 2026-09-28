import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TTS_VOICE_LIBRARY_STORAGE_KEY,
  deleteVoiceEntry,
  describeSavedVoice,
  describeVoiceLabel,
  filterVoiceEntries,
  findActiveVoiceEntry,
  findVoicePreset,
  isVoiceLibraryProvider,
  listProviderVoices,
  loadVoiceLibrary,
  normalizeLocalVoiceEntry,
  normalizeVoiceLibrary,
  reconcileGptSovitsVoices,
  saveVoiceLibrary,
  suggestVoiceName,
  upsertVoiceEntry,
  type LocalVoiceEntry,
  type LocalVoiceInput
} from './localVoiceLibrary';

function entry(overrides: Partial<LocalVoiceEntry> & Pick<LocalVoiceEntry, 'id'>): LocalVoiceEntry {
  return {
    provider: 'openai',
    name: '我的音色',
    model: 'gpt-4o-mini-tts',
    voice: 'alloy',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

function input(overrides: Partial<LocalVoiceInput> = {}): LocalVoiceInput {
  return { provider: 'openai', name: '', model: 'gpt-4o-mini-tts', voice: 'nova', ...overrides };
}

describe('localVoiceLibrary', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() {
        return values.size;
      }
    } satisfies Storage);
  });

  it('keeps only entries that name a known provider and a voice', () => {
    expect(normalizeLocalVoiceEntry(null)).toBeNull();
    expect(normalizeLocalVoiceEntry({ provider: 'openai' })).toBeNull();
    expect(normalizeLocalVoiceEntry({ provider: 'openai', voice: '   ' })).toBeNull();
    expect(normalizeLocalVoiceEntry({ provider: 'not-a-provider', voice: 'alloy' })).toBeNull();
  });

  it('repairs hand-written entries instead of dropping them', () => {
    const repaired = normalizeLocalVoiceEntry({
      provider: 'openai',
      voice: '  alloy  ',
      name: '  温柔  女声  '
    });
    expect(repaired).toMatchObject({
      id: 'voice-openai-gpt-4o-mini-tts-alloy',
      voice: 'alloy',
      model: 'gpt-4o-mini-tts',
      name: '温柔 女声',
      createdAt: 0,
      updatedAt: 0
    });
    // A blank name is not allowed: the entry still has to be identifiable.
    expect(normalizeLocalVoiceEntry({ provider: 'openai', voice: 'alloy' })?.name).toBe('OpenAI · alloy');
  });

  it('reads both the plain array and a wrapped payload, deduplicating ids', () => {
    const list = [
      entry({ id: 'a', name: '第一个' }),
      entry({ id: 'a', name: '覆盖' }),
      { provider: 'openai', voice: 'nova', name: '派生', createdAt: 5 }
    ];
    expect(normalizeVoiceLibrary(list).map((item) => item.name)).toEqual(['派生', '覆盖']);
    expect(normalizeVoiceLibrary({ voices: list })).toHaveLength(2);
    expect(normalizeVoiceLibrary('nonsense')).toEqual([]);
  });

  it('adds an entry with a suggested name and updates it in place afterwards', () => {
    const added = upsertVoiceEntry([], input(), 1000);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      provider: 'openai',
      voice: 'nova',
      name: 'OpenAI · nova',
      createdAt: 1000,
      updatedAt: 1000
    });

    const renamed = upsertVoiceEntry(added, input({ id: added[0].id, name: '夜读' }), 2000);
    expect(renamed).toHaveLength(1);
    expect(renamed[0]).toMatchObject({ name: '夜读', createdAt: 1000, updatedAt: 2000 });
  });

  it('falls back to the provider default model and clears an entry emptied of its voice', () => {
    const added = upsertVoiceEntry([], input({ provider: 'cartesia', model: '  ', voice: 'voice-1' }), 1000);
    expect(added[0].model).toBe('sonic-3.5');

    const removed = upsertVoiceEntry(added, input({ id: added[0].id, voice: '  ' }), 2000);
    expect(removed).toEqual([]);
    // Without an id there is nothing to update, so an empty voice adds nothing.
    expect(upsertVoiceEntry([], input({ voice: '' }), 3000)).toEqual([]);
  });

  it('sorts newest first per provider and never leaks another provider', () => {
    const entries = [
      entry({ id: 'old', createdAt: 10 }),
      entry({ id: 'new', createdAt: 30 }),
      entry({ id: 'eleven', provider: 'elevenlabs', createdAt: 20 })
    ];
    expect(listProviderVoices(entries, 'openai').map((item) => item.id)).toEqual(['new', 'old']);
    expect(listProviderVoices(entries, 'elevenlabs').map((item) => item.id)).toEqual(['eleven']);
    expect(listProviderVoices(entries, 'fish')).toEqual([]);
  });

  it('narrows the list to one model when asked, and shows everything otherwise', () => {
    const entries = [
      entry({ id: 'mini', model: 'gpt-4o-mini-tts', createdAt: 20 }),
      entry({ id: 'tts1', model: 'tts-1', createdAt: 10 })
    ];
    expect(listProviderVoices(entries, 'openai', 'gpt-4o-mini-tts').map((item) => item.id)).toEqual(['mini']);
    expect(listProviderVoices(entries, 'openai', ' tts-1 ').map((item) => item.id)).toEqual(['tts1']);
    // An unknown model is an empty list, not the whole provider…
    expect(listProviderVoices(entries, 'openai', 'tts-1-hd')).toEqual([]);
    // …while no model at all (or a blank one) keeps the provider-wide view.
    expect(listProviderVoices(entries, 'openai').map((item) => item.id)).toEqual(['mini', 'tts1']);
    expect(listProviderVoices(entries, 'openai', '  ').map((item) => item.id)).toEqual(['mini', 'tts1']);
  });

  it('searches by name, by id and by the preset label behind an id', () => {
    const entries = [
      entry({ id: 'a', name: '夜读', voice: 'alloy' }),
      entry({
        id: 'b',
        name: '旁白',
        provider: 'elevenlabs',
        model: 'eleven_multilingual_v2',
        voice: 'JBFqnCBsd6RMkjVDRZzb'
      })
    ];
    expect(filterVoiceEntries(entries, '').map((item) => item.id)).toEqual(['a', 'b']);
    expect(filterVoiceEntries(entries, '夜').map((item) => item.id)).toEqual(['a']);
    expect(filterVoiceEntries(entries, 'alloy').map((item) => item.id)).toEqual(['a']);
    expect(filterVoiceEntries(entries, 'gpt-4o').map((item) => item.id)).toEqual(['a']);
    // The ElevenLabs preset is searchable by the name shown in the dropdown.
    expect(filterVoiceEntries(entries, 'george').map((item) => item.id)).toEqual(['b']);
  });

  it('derives the active entry from the configuration that is actually in use', () => {
    const entries = [entry({ id: 'a' }), entry({ id: 'b', voice: 'nova', name: '夜读' })];
    expect(
      findActiveVoiceEntry(entries, { provider: 'openai', model: 'gpt-4o-mini-tts', voice: 'nova' })?.id
    ).toBe('b');
    expect(
      findActiveVoiceEntry(entries, { provider: 'openai', model: 'gpt-4o-mini-tts', voice: 'nova ' })?.id
    ).toBe('b');
    expect(
      findActiveVoiceEntry(entries, { provider: 'openai', model: 'tts-1', voice: 'nova' })
    ).toBeUndefined();
    expect(findActiveVoiceEntry(entries, { provider: 'openai', model: '', voice: '' })).toBeUndefined();
  });

  it('scopes the library to providers whose voice is picked in the settings page', () => {
    expect(isVoiceLibraryProvider('openai')).toBe(true);
    expect(isVoiceLibraryProvider('elevenlabs')).toBe(true);
    // GPT-SoVITS picks a role preset in the same page, so it is saved the same way.
    expect(isVoiceLibraryProvider('gpt-sovits')).toBe(true);
    expect(isVoiceLibraryProvider('microsoft')).toBe(false);
    expect(isVoiceLibraryProvider('none')).toBe(false);
  });

  it('resolves saved ids against the presets the owner supplies', () => {
    const presets = [
      { id: 'prof-1', name: '白瓜' },
      { id: 'prof-2', name: '可莉' }
    ];
    expect(findVoicePreset(presets, ' prof-1 ')?.name).toBe('白瓜');
    expect(findVoicePreset(presets, 'prof-gone')).toBeUndefined();
    expect(findVoicePreset(undefined, 'prof-1')).toBeUndefined();
    // No presets at all means "a plain provider": its own table decides the label.
    const role = { provider: 'gpt-sovits' as const, voice: 'prof-1' };
    expect(describeSavedVoice(role, presets)).toBe('白瓜');
    expect(describeSavedVoice({ ...role, voice: 'prof-gone' }, presets)).toBe('prof-gone（角色未找到）');
    expect(describeSavedVoice(role)).toBe('prof-1');
  });

  it('offers the role name as the entry name and searches it, presets included', () => {
    const presets = [{ id: 'prof-1', name: '白瓜' }];
    expect(suggestVoiceName('gpt-sovits', 'prof-1', presets)).toBe('白瓜');
    // The role is already a name, so it is not prefixed like a raw Voice ID.
    expect(suggestVoiceName('gpt-sovits', 'prof-1')).toBe('GPT-SoVITS · prof-1');
    const entries = [
      entry({ id: 'role', provider: 'gpt-sovits', name: '常用', model: 'api_v2', voice: 'prof-1' })
    ];
    expect(filterVoiceEntries(entries, '白瓜', presets).map((item) => item.id)).toEqual(['role']);
    expect(filterVoiceEntries(entries, 'prof-1', presets).map((item) => item.id)).toEqual(['role']);
    expect(filterVoiceEntries(entries, '白瓜')).toEqual([]);
  });

  it('round-trips through local storage', () => {
    saveVoiceLibrary([entry({ id: 'a', name: '夜读', createdAt: 7, updatedAt: 8 })]);
    expect(JSON.parse(localStorage.getItem(TTS_VOICE_LIBRARY_STORAGE_KEY) ?? '[]')).toHaveLength(1);
    expect(loadVoiceLibrary()).toEqual([entry({ id: 'a', name: '夜读', createdAt: 7, updatedAt: 8 })]);
  });

  it('aligns GPT-SoVITS voices to saved roles while preserving other providers and aliases', () => {
    const existing = [
      entry({ id: 'remote' }),
      entry({ id: 'kept', provider: 'gpt-sovits', voice: 'role-a', model: 'old', name: '我的别名' }),
      entry({ id: 'duplicate', provider: 'gpt-sovits', voice: 'role-a', model: 'api_v2' }),
      entry({ id: 'stale', provider: 'gpt-sovits', voice: 'deleted', model: 'api_v2' })
    ];
    const roles = [{ id: 'role-a', name: '甲' }, { id: 'role-b', name: '乙' }];
    const result = reconcileGptSovitsVoices(existing, roles, 100);
    expect(result.filter((item) => item.provider === 'gpt-sovits')).toHaveLength(2);
    expect(result.find((item) => item.id === 'kept')).toMatchObject({ name: '我的别名', model: 'api_v2' });
    expect(result.find((item) => item.voice === 'role-b')).toMatchObject({ name: '乙', model: 'api_v2' });
    expect(result.some((item) => item.id === 'remote')).toBe(true);
    expect(result.some((item) => item.id === 'stale' || item.id === 'duplicate')).toBe(false);
    expect(reconcileGptSovitsVoices(result, roles, 101)).toEqual(result);
  });

  it('deletes by id and ignores unknown ids', () => {
    const entries = [entry({ id: 'a' }), entry({ id: 'b' })];
    expect(deleteVoiceEntry(entries, 'a').map((item) => item.id)).toEqual(['b']);
    expect(deleteVoiceEntry(entries, 'missing')).toHaveLength(2);
  });

  it('labels preset voices by their display name and custom ones by their id', () => {
    expect(describeVoiceLabel('openai', 'alloy')).toBe('alloy');
    expect(describeVoiceLabel('elevenlabs', 'JBFqnCBsd6RMkjVDRZzb')).toBe('George');
    expect(describeVoiceLabel('fish', '0089dce5fefb4c6ba9b9f2f0debe1ddc')).toBe(
      '0089dce5fefb4c6ba9b9f2f0debe1ddc'
    );
    expect(suggestVoiceName('fish', '  ')).toBe('Fish Audio');
  });
});
