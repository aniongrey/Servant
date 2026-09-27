import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHARACTER_PROFILES_KEY,
  loadCharacterProfiles,
  saveCharacterProfiles,
  suggestedSpeakerId,
  type CharacterProfile
} from './characterProfiles';

const profile: CharacterProfile = {
  id: 'design', name: '设计', avatarId: 'girl-01', characterCardId: 'builtin',
  voiceId: '', vrmId: 'main', isMain: true, createdAt: 1
};

const storage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => storage.clear()
};
vi.stubGlobal('localStorage', localStorageMock);
afterEach(() => localStorage.clear());

describe('character profiles and meeting turn hints', () => {
  it('round-trips validated character bindings', () => {
    saveCharacterProfiles([profile, { ...profile, id: 'broken', name: undefined as never }]);
    expect(loadCharacterProfiles()).toEqual([profile]);
    expect(localStorage.getItem(CHARACTER_PROFILES_KEY)).toContain('design');
  });

  it('accepts only a next speaker in the active roster', () => {
    expect(suggestedSpeakerId('{"speech":"先讨论"}{"next_speaker_id":"dev"}', ['design', 'dev'])).toBe('dev');
    expect(suggestedSpeakerId('{"next_speaker_id":"removed"}', ['design'])).toBeNull();
  });
});
