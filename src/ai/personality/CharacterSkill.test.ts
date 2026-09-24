import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyCharacterPromptSettings,
  loadCharacterPromptSettings,
  parseCharacterSkill,
  emptyCharacterSkill,
  saveCharacterPromptSettings
} from './CharacterSkill';

describe('CharacterSkill', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses a CSP skills.md without reducing the source to card fields', () => {
    const skill = parseCharacterSkill(
      `---
name: takamatsu-tomori
description: |
  高松灯，MyGO!!!!! 主唱。
---

# 高松灯 · 想要成为人类的迷子

## 表达质感

- 短句为主
- 大量停顿
`,
      'takamatsu-tomori.md'
    );

    expect(skill.fileName).toBe('takamatsu-tomori.md');
    expect(skill.config.id).toBe('takamatsu-tomori');
    expect(skill.config.displayName).toBe('高松灯');
    expect(skill.config.identity).toBe('高松灯，MyGO!!!!! 主唱。');
    expect(skill.config.skillContent).toContain('大量停顿');
  });

  it('rejects an empty skills file', () => {
    expect(() => parseCharacterSkill('  ')).toThrow('skills.md 不能为空');
  });

  it('provides an empty selection without skills content', () => {
    expect(emptyCharacterSkill.config.skillContent).toBeUndefined();
  });

  it('persists and conditionally applies the additional prompt', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    });
    vi.stubGlobal('dispatchEvent', vi.fn());
    const skill = parseCharacterSkill('# 白');

    saveCharacterPromptSettings({ enabled: true, prompt: '  回答简短。  ' });
    expect(applyCharacterPromptSettings(skill, loadCharacterPromptSettings()).config.additionalPrompt).toBe(
      '回答简短。'
    );
    expect(
      applyCharacterPromptSettings(skill, { enabled: false, prompt: '回答简短。' }).config.additionalPrompt
    ).toBeUndefined();
  });
});
