export const CHARACTER_PROFILES_KEY = 'servant.characterProfiles.v1';

export const CHARACTER_AVATARS = [
  { id: 'male-01', label: '青年', symbol: '👨🏻‍🦱', image: '/assets/avatars/servant-avatar-default-male-v1.png', gender: '男' },
  { id: 'girl-01', label: '银紫少女', symbol: '👧🏻', image: '/assets/avatars/servant-avatar-default-female-lavender-v1.png', gender: '女' },
  { id: 'girl-02', label: '玫瑰少女', symbol: '👩🏻‍🎤', image: '/assets/avatars/servant-avatar-default-female-rose-v1.png', gender: '女' },
  { id: 'girl-03', label: '蓝发少女', symbol: '👸🏻', image: '/assets/avatars/servant-avatar-default-female-blue-v1.png', gender: '女' },
  { id: 'girl-04', label: '森系少女', symbol: '🧝🏻‍♀️', image: '/assets/avatars/servant-avatar-default-female-sage-v1.png', gender: '女' }
] as const;

export interface CharacterProfile {
  id: string;
  name: string;
  avatarId: string;
  characterCardId: string;
  voiceId: string;
  vrmId: string;
  isMain: boolean;
  createdAt: number;
}

export function loadCharacterProfiles(): CharacterProfile[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(CHARACTER_PROFILES_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter(isCharacterProfile);
  } catch {
    return [];
  }
}

export function saveCharacterProfiles(profiles: CharacterProfile[]): void {
  if (typeof localStorage !== 'undefined')
    localStorage.setItem(CHARACTER_PROFILES_KEY, JSON.stringify(profiles));
}

export function makeCharacterProfile(input: Partial<CharacterProfile> = {}): CharacterProfile {
  return {
    id: input.id ?? `character-${crypto.randomUUID()}`,
    name: input.name?.trim() || '新角色',
    avatarId: input.avatarId ?? 'girl-01',
    characterCardId: input.characterCardId ?? 'builtin',
    voiceId: input.voiceId ?? '',
    vrmId: input.vrmId ?? 'main',
    isMain: input.isMain === true,
    createdAt: input.createdAt ?? Date.now()
  };
}

export function avatarFor(id: string) {
  return CHARACTER_AVATARS.find((avatar) => avatar.id === id) ?? CHARACTER_AVATARS[1];
}

/** Reads the optional next_speaker_id from the response's final JSON object. */
export function suggestedSpeakerId(raw: string | undefined, allowedIds: readonly string[]): string | null {
  if (!raw) return null;
  const records: Record<string, unknown>[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (start < 0) {
      if (char === '{') {
        start = i;
        depth = 1;
      }
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) {
      try {
        const parsed: unknown = JSON.parse(raw.slice(start, i + 1));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
          records.push(parsed as Record<string, unknown>);
      } catch {
        // Invalid protocol fragments are ignored; scheduling falls back safely.
      }
      start = -1;
    }
  }
  for (const record of records.reverse()) {
    const value = record.next_speaker_id;
    if (typeof value === 'string' && allowedIds.includes(value)) return value;
  }
  return null;
}

function isCharacterProfile(value: unknown): value is CharacterProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Partial<CharacterProfile>;
  return (
    typeof profile.id === 'string' &&
    typeof profile.name === 'string' &&
    typeof profile.avatarId === 'string' &&
    typeof profile.characterCardId === 'string' &&
    typeof profile.voiceId === 'string' &&
    typeof profile.vrmId === 'string' &&
    typeof profile.isMain === 'boolean' &&
    typeof profile.createdAt === 'number' &&
    Number.isFinite(profile.createdAt)
  );
}
