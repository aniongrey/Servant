import { describe, expect, it } from 'vitest';
import { resolveSettingsSection, settingsSections } from './settingsSections';

describe('settings sections', () => {
  it('maps a panel named in the URL to that panel', () => {
    expect(resolveSettingsSection('llm')).toBe('llm');
    expect(resolveSettingsSection('character-settings')).toBe('character-settings');
  });

  it('keeps `voice` working as the alias older links used for the voice panel', () => {
    expect(resolveSettingsSection('voice')).toBe('tts');
  });

  it('ignores a missing or unknown panel instead of guessing one', () => {
    expect(resolveSettingsSection(null)).toBeNull();
    expect(resolveSettingsSection(undefined)).toBeNull();
    expect(resolveSettingsSection('')).toBeNull();
    expect(resolveSettingsSection('llm-settings')).toBeNull();
  });

  it('lists each panel exactly once', () => {
    const ids = settingsSections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
