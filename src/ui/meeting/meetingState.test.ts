import { describe, expect, it, vi } from 'vitest';
import {
  loadMeetingDesktopCast,
  loadMeetingAutoTurnLimit,
  loadMeetings,
  meetingContext,
  meetingDelta,
  meetingDeltaStart,
  meetingSpeakerCard,
  meetingTarget,
  meetingTurnPrompt,
  nextAutoSpeaker,
  speakerCursor,
  MEETINGS_KEY,
  MEETING_AUTO_TURN_LIMIT_KEY,
  MEETING_DELTA_LIMIT,
  searchMeetingHistory,
  setMeetingDesktopCast,
  saveMeetingAutoTurnLimit,
  type MeetingMessage,
  type MeetingSession
} from './meetingState';
import { parseCharacterSkill } from '../../ai/personality/CharacterSkill';
import type { CharacterProfile } from '../../character/characterProfiles';

describe('meeting auto-turn limit', () => {
  it('shares a bounded setting through local storage', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    });
    try {
      expect(loadMeetingAutoTurnLimit()).toBe(8);
      expect(saveMeetingAutoTurnLimit(120)).toBe(99);
      expect(values.get(MEETING_AUTO_TURN_LIMIT_KEY)).toBe('99');
      expect(loadMeetingAutoTurnLimit()).toBe(99);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

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

describe('meeting delta and auto speaker', () => {
  const people: CharacterProfile[] = [
    { ...profile, id: 'a', name: 'A', isMain: false },
    { ...profile, id: 'b', name: 'B', isMain: false },
    { ...profile, id: 'c', name: 'C', isMain: false }
  ];
  const line = (id: string, senderId: string, text: string): MeetingMessage => ({
    id,
    senderId,
    text,
    createdAt: 1
  });
  const tri = (messages: MeetingMessage[]): MeetingSession => ({
    ...meeting,
    id: 'tri',
    goal: '决定主题色',
    participants: ['a', 'b', 'c'],
    messages
  });
  const spoke = (session: MeetingSession, id: string, text: string): MeetingSession => ({
    ...session,
    messages: [...session.messages, line(`${id}-${text}`, id, text)]
  });

  it('gives a first-time speaker the recent discussion, not the whole history', () => {
    // 从未发言 = 没有游标，此时不能把整场历史灌进去，长会议会撑爆这一轮。
    const long = tri(Array.from({ length: 30 }, (_, index) => line(`m-${index}`, 'a', `第 ${index} 句`)));
    const delta = meetingDelta(long, 'c');
    expect(delta).toHaveLength(MEETING_DELTA_LIMIT);
    expect(delta.at(-1)?.text).toBe('第 29 句');
  });

  it('shows A what B said after A spoke', () => {
    const session = tri([line('u', 'user', '开始'), line('a1', 'a', 'A 的观点')]);
    expect(meetingDelta(session, 'b').map(({ text }) => text)).toEqual(['开始', 'A 的观点']);
  });

  it('does not put a character’s own consumed lines back into its delta', () => {
    const session = tri([
      line('u', 'user', '开始'),
      line('a1', 'a', 'A 的观点'),
      line('b1', 'b', 'B 的观点')
    ]);
    // A 的游标停在自己那句上，delta 从它之后开始算。
    expect(speakerCursor(session, 'a')).toBe(1);
    expect(meetingDelta(session, 'a').map(({ text }) => text)).toEqual(['B 的观点']);
    expect(meetingDelta(session, 'a').some(({ senderId }) => senderId === 'a')).toBe(false);
  });

  it('lets the third character see the discussion it missed', () => {
    const session = tri([
      line('u', 'user', '开始'),
      line('a1', 'a', 'A 的观点'),
      line('b1', 'b', 'B 的观点')
    ]);
    expect(meetingDelta(session, 'c').map(({ text }) => text)).toEqual(['开始', 'A 的观点', 'B 的观点']);
  });

  it('feeds a new user line into everyone’s delta', () => {
    const before = tri([line('a1', 'a', 'A 的观点'), line('b1', 'b', 'B 的观点')]);
    const after = spoke(before, 'user', '等等，先听我说');
    expect(meetingDelta(after, 'a').at(-1)?.text).toBe('等等，先听我说');
    expect(meetingDelta(after, 'b').at(-1)?.text).toBe('等等，先听我说');
    expect(meetingDelta(after, 'c').at(-1)?.text).toBe('等等，先听我说');
  });

  it('separates the missed discussion from the line to answer', () => {
    const session = tri([
      line('a1', 'a', 'A 的观点'),
      line('b1', 'b', 'B 的观点'),
      line('c1', 'c', 'C 的观点')
    ]);
    expect(meetingTarget(session, 'a')?.senderId).toBe('c');
    const text = meetingTurnPrompt(session, people, 'Master', 'a').text;
    expect(text).toContain('【你上次发言之后，会议新增了以下内容】');
    expect(text).toContain('B 的观点');
    expect(text).toContain('【当前讨论焦点】');
    // 焦点只出现一次作为接话点，其余内容都在「错过的讨论」里，模型不会逐条回复。
    expect(text.indexOf('【当前讨论焦点】')).toBeGreaterThan(text.indexOf('C 的观点'));
  });

  it('falls back to the last line from someone else when the delta is empty', () => {
    // 自己就是最后发言人（队列里连着排了同一个人）。
    const session = tri([line('u', 'user', '开始'), line('a1', 'a', 'A 的观点')]);
    expect(meetingDelta(session, 'a')).toEqual([]);
    expect(meetingTarget(session, 'a')?.text).toBe('开始');
    expect(meetingTurnPrompt(session, people, 'Master', 'a').text).toContain('会议还没有新的讨论');
  });

  it('never lets the same character speak twice in a row', () => {
    const session = spoke(tri([line('u', 'user', '开始')]), 'b', 'B 的观点');
    // 就算调用方忘了把刚说过的人排除掉，调度器也要自己拦住。
    expect(nextAutoSpeaker(session, ['a', 'b', 'c'])).not.toBe('b');
    expect(nextAutoSpeaker(spoke(tri([]), 'a', 'A'), ['a'])).toBe('a');
  });

  it('rotates A → B → C → A instead of bouncing between the first two', () => {
    // 旧的兜底取 allowed[0]：A 说完选 B，B 说完又选 A，第三人一次都轮不到。
    let session = tri([line('u', 'user', '开始')]);
    const order: string[] = [];
    for (let turn = 0; turn < 3; turn += 1) {
      const next = nextAutoSpeaker(session, session.participants);
      expect(next).toBeDefined();
      order.push(next as string);
      session = spoke(session, next as string, `${next} 的观点`);
    }
    // A 的游标停在自己第一句上，所以它重新被叫到时能看到 B、C 后来聊的内容。
    expect(meetingDelta(session, 'a').map(({ text }) => text)).toEqual(['b 的观点', 'c 的观点']);
    // 三个人都说过了 → 按最早发言时间回到 A，而不是卡在 B、C 之间。
    order.push(nextAutoSpeaker(session, session.participants) as string);
    expect(order).toEqual(['a', 'b', 'c', 'a']);
  });

  it('suppresses a suggestion that would bounce the turn straight back', () => {
    const session = tri([line('a1', 'a', 'A 的观点'), line('b1', 'b', 'B 的观点')]);
    // B 刚说完，模型把话丢回 A —— 这正是互相附和的死循环，改用 LRU 让 C 进来。
    expect(nextAutoSpeaker(session, ['a', 'c'], 'a')).toBe('c');
    expect(nextAutoSpeaker(session, ['a', 'c'], 'c')).toBe('c');
    expect(nextAutoSpeaker(session, ['a', 'c'])).toBe('c');
  });

  it('keeps the system transcript clear of what the turn already carries', () => {
    const session = tri([
      line('u', 'user', '开始'),
      line('a1', 'a', 'A 的观点'),
      line('b1', 'b', 'B 的观点'),
      line('c1', 'c', 'C 的观点')
    ]);
    const start = meetingDeltaStart(session, 'a');
    const context = meetingContext(session, people, 'Master', 'a', start);
    expect(context).toContain('更早的会议记录');
    expect(context).not.toContain('B 的观点');
    expect(context).not.toContain('C 的观点');
    expect(meetingContext(session, people, 'Master', 'a')).toContain('C 的观点');
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
