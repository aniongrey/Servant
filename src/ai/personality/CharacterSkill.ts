import type { PersonalityConfig } from '../llm/types';
import { backendFetch } from '../../app/network/backendFetch.ts';

const CHARACTER_SKILL_API = '/api/character-skill';
export const CHARACTER_SKILL_UPDATED_EVENT = 'codex-list.characterSkill.updated';
export const CHARACTER_SKILL_SELECTION_KEY = 'codex-list.characterSkill.selection';
export const CHARACTER_PROMPT_SETTINGS_UPDATED_EVENT = 'codex-list.characterPromptSettings.updated';
export const CHARACTER_PROMPT_SETTINGS_KEY = 'codex-list.characterPromptSettings.v1';

export interface CharacterPromptSettings {
  enabled: boolean;
  prompt: string;
}

export interface CharacterSkill {
  fileName: string;
  markdown: string;
  config: PersonalityConfig;
}
export interface CharacterSkillLibrary {
  activeId: string;
  cards: Array<CharacterSkill & { id: string }>;
}

export const emptyCharacterSkill: CharacterSkill = {
  fileName: '',
  markdown: '',
  config: {
    id: 'shiro',
    displayName: '无角色卡',
    identity: '陪伴型数字生命',
    traits: [],
    speakingStyle: [],
    boundaries: [],
    defaultEmotion: 'neutral'
  }
};

export function loadCharacterPromptSettings(): CharacterPromptSettings {
  if (typeof localStorage === 'undefined') return { enabled: false, prompt: '' };
  try {
    const value = JSON.parse(
      localStorage.getItem(CHARACTER_PROMPT_SETTINGS_KEY) ?? 'null'
    ) as Partial<CharacterPromptSettings> | null;
    return {
      enabled: value?.enabled === true,
      prompt: typeof value?.prompt === 'string' ? value.prompt : ''
    };
  } catch {
    return { enabled: false, prompt: '' };
  }
}

export function saveCharacterPromptSettings(settings: CharacterPromptSettings): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(CHARACTER_PROMPT_SETTINGS_KEY, JSON.stringify(settings));
  globalThis.dispatchEvent(
    new CustomEvent<CharacterPromptSettings>(CHARACTER_PROMPT_SETTINGS_UPDATED_EVENT, {
      detail: settings
    })
  );
}

export function applyCharacterPromptSettings(
  skill: CharacterSkill,
  settings: CharacterPromptSettings
): CharacterSkill {
  const prompt = settings.enabled ? settings.prompt.trim() : '';
  return {
    ...skill,
    config: { ...skill.config, additionalPrompt: prompt || undefined }
  };
}

export async function loadCharacterSkillLibrary(signal?: AbortSignal): Promise<CharacterSkillLibrary> {
  return requestLibrary('GET', undefined, signal);
}
export async function selectCharacterSkill(id: string): Promise<CharacterSkillLibrary> {
  return requestLibrary('PUT', { id });
}
export async function deleteCharacterSkill(id: string): Promise<CharacterSkillLibrary> {
  return requestLibrary('DELETE', undefined, undefined, `/${encodeURIComponent(id)}`);
}
async function requestLibrary(
  method: string,
  body?: unknown,
  signal?: AbortSignal,
  suffix = ''
): Promise<CharacterSkillLibrary> {
  const response = await backendFetch(`${CHARACTER_SKILL_API}/library${suffix}`, {
    method,
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `角色卡操作失败 (${response.status})`);
  if (typeof value.activeId !== 'string' || !Array.isArray(value.cards)) throw new Error('角色卡列表无效。');
  const cards = value.cards.map((card: { id: unknown }) => {
    if (typeof card.id !== 'string') throw new Error('角色卡编号无效。');
    return { ...parseApiSkill(card), id: card.id };
  });
  const active = cards.find((card: CharacterSkill & { id: string }) => card.id === value.activeId);
  if (method !== 'GET') {
    localStorage.setItem(
      CHARACTER_SKILL_SELECTION_KEY,
      JSON.stringify({ id: value.activeId, updatedAt: Date.now() })
    );
    globalThis.dispatchEvent(new CustomEvent<CharacterSkill>(CHARACTER_SKILL_UPDATED_EVENT, {
      detail: active ?? emptyCharacterSkill
    }));
  }
  return { activeId: value.activeId, cards };
}

const fallbackConfig: PersonalityConfig = {
  id: 'shiro',
  displayName: '白',
  identity: '陪伴型数字生命',
  traits: ['清冷', '寡言', '嘴硬', '傲娇'],
  speakingStyle: ['句子通常较短', '很少长篇解释', '不会使用客服语气', '不会过度热情'],
  boundaries: ['不会主动索取隐私'],
  defaultEmotion: 'neutral'
};

export const pendingCharacterSkill: CharacterSkill = {
  fileName: '加载中',
  markdown: '',
  config: fallbackConfig
};

export function parseCharacterSkill(markdown: string, fileName = 'skills.md'): CharacterSkill {
  const content = markdown.trim();
  if (!content) throw new Error('skills.md 不能为空。');
  const frontMatter = readFrontMatter(content);
  const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const description = frontMatter.description?.replace(/\s+/g, ' ').trim();
  const displayName = title?.split(/[·|｜]/)[0]?.trim() || frontMatter.name || fallbackConfig.displayName;
  const identity =
    (description && !['|', '>'].includes(description) ? description : undefined) ||
    content.match(/^\*\*我是谁\*\*：(.+)$/m)?.[1]?.trim() ||
    fallbackConfig.identity;
  const traits = extractList(content, ['行为动态', '默认状态', '表达质感', '社会认知']).slice(0, 8);
  const config: PersonalityConfig = {
    ...fallbackConfig,
    id: frontMatter.name || slugify(displayName),
    displayName,
    identity,
    traits: traits.length ? traits : fallbackConfig.traits,
    speakingStyle: extractSectionLines(content, '表达质感').slice(0, 12) || fallbackConfig.speakingStyle,
    boundaries: extractSectionLines(content, '诚实边界').slice(0, 8) || fallbackConfig.boundaries,
    skillContent: content
  };
  return { fileName, markdown: content, config };
}

export async function loadCharacterSkill(signal?: AbortSignal): Promise<CharacterSkill> {
  const response = await backendFetch(CHARACTER_SKILL_API, { signal });
  if (!response.ok) throw new Error(`角色卡读取失败 (${response.status})`);
  const value = await response.json();
  return value === null ? emptyCharacterSkill : parseApiSkill(value);
}

export async function importCharacterSkill(
  markdown: string,
  fileName = 'skills.md'
): Promise<CharacterSkill> {
  const skill = parseCharacterSkill(markdown, fileName);
  const library = await requestLibrary('POST', { fileName: skill.fileName, markdown: skill.markdown });
  return library.cards.find((card) => card.id === library.activeId)!;
}

function parseApiSkill(value: unknown): CharacterSkill {
  if (!value || typeof value !== 'object') throw new Error('角色卡接口返回无效数据。');
  const { fileName, markdown } = value as { fileName?: unknown; markdown?: unknown };
  if (typeof fileName !== 'string' || typeof markdown !== 'string')
    throw new Error('角色卡接口返回无效数据。');
  return parseCharacterSkill(markdown, fileName);
}
function readFrontMatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const lines = match[1].split(/\r?\n/);
  const result: Record<string, string> = {};
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (rawValue === '|' || rawValue === '>') {
      const continuation: string[] = [];
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1]))
        continuation.push(lines[++index].trim());
      result[key] = continuation.join(rawValue === '>' ? ' ' : '\n');
    } else result[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
  return result;
}
function extractSectionLines(markdown: string, heading: string): string[] {
  const match = markdown.match(
    new RegExp(`^###?\\s+${escapeRegExp(heading)}[\\s\\S]*?(?=^###?\\s+|\\n---|$)`, 'm')
  );
  return (
    match?.[0]
      .split(/\r?\n/)
      .filter((line) => /^[-*]\s+/.test(line))
      .map((line) => line.replace(/^[-*]\s+/, '').trim())
      .filter(Boolean) ?? []
  );
}
function extractList(markdown: string, headings: string[]): string[] {
  return headings.flatMap((heading) => extractSectionLines(markdown, heading));
}
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'character'
  );
}
