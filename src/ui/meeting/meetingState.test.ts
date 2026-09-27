import { describe, expect, it, vi } from 'vitest';
import {
  loadMeetingDesktopCast,
  meetingContext,
  meetingTurnPrompt,
  searchMeetingHistory,
  setMeetingDesktopCast,
  type MeetingSession
} from './meetingState';
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
