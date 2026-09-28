import { describe, expect, it, vi } from 'vitest';
import {
  loadMeetingDesktopCast,
  loadMeetings,
  meetingContext,
  meetingSpeakerCard,
  meetingTurnPrompt,
  MEETINGS_KEY,
  searchMeetingHistory,
  setMeetingDesktopCast,
  type MeetingSession
} from './meetingState';
import { parseCharacterSkill } from '../../ai/personality/CharacterSkill';
import type { CharacterProfile } from '../../character/characterProfiles';

const profile: CharacterProfile = {
  id: 'main',
  name: '米娅',
  avatarId: 'girl-01',
  characterCardId: 'builtin',
  voiceId: '',
  vrmId: 'main',
  isMain: true,
  createdAt: 1
};

const meeting: MeetingSession = {
  id: 'meeting',
  title: '讨论',
  goal: '',
  participants: ['main'],
  messages: [
    { id: 'user-1', senderId: 'user', text: '我喜欢蓝色', createdAt: 1 },
    { id: 'agent-1', senderId: 'main', text: '我会考虑蓝色主题', createdAt: 2 }
  ],
  queue: [],
  status: 'active',
  mode: 'manual',
  conclusions: [],
  tasks: [],
  summary: '',
  updatedAt: 2
};

describe('meeting identity and speaker selection', () => {
  it('keeps the human and current Agent identities explicit in context', () => {
    const context = meetingContext(meeting, [profile], 'Master', profile.id);
    expect(context).toContain('[用户 · Master]：我喜欢蓝色');
    expect(context).toContain('[角色 · 米娅 / main]：我会考虑蓝色主题');
    expect(context).toContain('本轮唯一应答角色是“米娅”');
  });

  it('searches recoverable meetings by title, participant, or message', () => {
    expect(searchMeetingHistory([meeting], [profile], '米娅').map(({ id }) => id)).toEqual(['meeting']);
    expect(searchMeetingHistory([meeting], [profile], '蓝色').map(({ id }) => id)).toEqual(['meeting']);
    expect(searchMeetingHistory([meeting], [profile], '不存在')).toEqual([]);
  });
});

describe('meeting turn anchor', () => {
  it('is always a user turn naming the speaker, never an assistant line', () => {
    // The queue runs characters back to back, so a turn that ended on an
    // `assistant` line would leave every speaker after the first without a
    // clear thing to answer.
    const turn = meetingTurnPrompt(meeting, [profile], 'Master', profile.id);
    expect(turn.role).toBe('user');
    expect(turn.text).toContain('米娅');
    expect(turn.text).toContain('我喜欢蓝色');
    expect(turn.id).not.toBe('user-1');
  });

  it('falls back to the meeting goal when nobody has spoken yet', () => {
    const fresh: MeetingSession = { ...meeting, messages: [], goal: '决定主题色' };
    const turn = meetingTurnPrompt(fresh, [profile], 'Master', profile.id);
    expect(turn.role).toBe('user');
    expect(turn.text).toContain('决定主题色');
  });

  it('still produces an anchor when the goal is empty too', () => {
    const blank: MeetingSession = { ...meeting, messages: [], goal: '' };
    expect(meetingTurnPrompt(blank, [profile], 'Master', profile.id).text).toContain('米娅');
  });

  it('gives each queue position a distinct id', () => {
    const first = meetingTurnPrompt(meeting, [profile], 'Master', profile.id);
    const second = meetingTurnPrompt(
      {
        ...meeting,
        messages: [...meeting.messages, { id: 'a-2', senderId: 'main', text: '好的', createdAt: 3 }]
      },
      [profile],
      'Master',
      profile.id
    );
    expect(first.id).not.toBe(second.id);
  });
});

describe('meeting speaker card', () => {
  const cards = [
    { ...parseCharacterSkill('# 白', 'shiro.md'), id: 'shiro' },
    { ...parseCharacterSkill('# 内置', 'builtin.md'), id: 'builtin' }
  ];
  const alice: CharacterProfile = { ...profile, id: 'alice', isMain: false, characterCardId: 'shiro' };

  it('folds in the global additional prompt, the way single-character chat does', () => {
    // Multi-person chat used to hand `card.config` straight to the LLM, so the
    // 「追加提示词」 toggle in the settings window did nothing here.
    const card = meetingSpeakerCard(cards, alice, { enabled: true, prompt: '  每次只说一句。  ' });
    expect(card.config.displayName).toBe('白');
    expect(card.config.additionalPrompt).toBe('每次只说一句。');
  });

  it('carries no additional prompt while the global setting is off', () => {
    expect(
      meetingSpeakerCard(cards, alice, { enabled: false, prompt: '每次只说一句。' }).config.additionalPrompt
    ).toBeUndefined();
  });

  it('still falls back to the built-in card, then to no card at all', () => {
    const builtin = meetingSpeakerCard(
      cards,
      { ...alice, characterCardId: 'missing' },
      {
        enabled: false,
        prompt: ''
      }
    );
    expect(builtin.fileName).toBe('builtin.md');
    const none = meetingSpeakerCard([], alice, { enabled: true, prompt: '保持简短。' });
    expect(none.config.displayName).toBe('无角色卡');
    expect(none.config.additionalPrompt).toBe('保持简短。');
  });
});

describe('desktop meeting cast', () => {
  it('keeps only the active meeting id', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key)
    });
    try {
      setMeetingDesktopCast('meeting');
      expect(loadMeetingDesktopCast()).toBe('meeting');
      setMeetingDesktopCast(null);
      expect(loadMeetingDesktopCast()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('stored meetings with the optional performance fields', () => {
  function stubStoredMeetings(value: unknown) {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === MEETINGS_KEY ? JSON.stringify(value) : null)
    });
  }

  it('still loads meetings saved before emotion / shortAction existed', () => {
    // 表演字段是后加的。老记录里没有它们，如果校验把它们当成必需字段，
    // 升级后每个人的整场聊天记录都会被静默丢掉。
    stubStoredMeetings([{ ...meeting, messages: meeting.messages }]);
    expect(loadMeetings()).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it('keeps a stored performance payload intact', () => {
    stubStoredMeetings([
      {
        ...meeting,
        messages: [
          {
            ...meeting.messages[1],
            emotion: 'happy',
            intensity: 0.8,
            shortAction: 'happy_small',
            estimatedDurationMs: 1800
          }
        ]
      }
    ]);
    const [loaded] = loadMeetings();
    expect(loaded.messages[0]).toMatchObject({
      emotion: 'happy',
      intensity: 0.8,
      shortAction: 'happy_small',
      estimatedDurationMs: 1800
    });
    vi.unstubAllGlobals();
  });

  it('rejects a message whose performance payload is the wrong type', () => {
    stubStoredMeetings([
      { ...meeting, messages: [{ ...meeting.messages[0], emotion: 42 }] }
    ]);
    expect(loadMeetings()).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});
