import type { CharacterProfile } from '../../character/characterProfiles';
import type { ChatMessage, PersonalityMood } from '../../ai/llm/types';
import {
  applyCharacterPromptSettings,
  emptyCharacterSkill,
  type CharacterPromptSettings,
  type CharacterSkill
} from '../../ai/personality/CharacterSkill';

export const MEETINGS_KEY = 'servant.meetings.v1';
export const MEETINGS_DELETED_KEY = 'servant.meetings.deleted.v1';
export const MEETING_DESKTOP_CAST_KEY = 'servant.meetingDesktopCast.v1';
export type MeetingStatus = 'active' | 'paused' | 'ended';
export type MeetingMode = 'manual' | 'all' | 'auto';

export interface MeetingMessage {
  id: string;
  senderId: string | 'user';
  text: string;
  createdAt: number;
  interrupted?: boolean;
  /**
   * 这条消息**在舞台上要怎么演**：表情（脸）与身体动作由 LLM 一段一段给出，
   * 与 `text` 同源，落在这里比走广播更可靠——广播可能因为窗口没开、刷新而丢，
   * 落了库那么「舞台重开时正在说的那句话」也能立刻恢复正确的表情标签。
   *
   * 这些字段只用于展示与表演，不参与 LLM 上下文。
   */
  emotion?: PersonalityMood;
  intensity?: number;
  shortAction?: string;
  /** 该段的预计语音时长（毫秒），供舞台打字机反推速度。 */
  estimatedDurationMs?: number;
}

export interface MeetingSession {
  id: string;
  title: string;
  goal: string;
  participants: string[];
  messages: MeetingMessage[];
  queue: string[];
  status: MeetingStatus;
  mode: MeetingMode;
  conclusions: string[];
  tasks: string[];
  summary: string;
  updatedAt: number;
}

export function loadMeetings(): MeetingSession[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(MEETINGS_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter(isMeeting) : [];
  } catch {
    return [];
  }
}

export function saveMeetings(meetings: MeetingSession[]): void {
  localStorage.setItem(MEETINGS_KEY, JSON.stringify(meetings));
  globalThis.dispatchEvent?.(new Event('servant:meetings-changed'));
}

export function loadMeetingDesktopCast(): string | null {
  const value = localStorage.getItem(MEETING_DESKTOP_CAST_KEY)?.trim();
  return value || null;
}

export function setMeetingDesktopCast(sessionId: string | null): void {
  if (sessionId) localStorage.setItem(MEETING_DESKTOP_CAST_KEY, sessionId);
  else localStorage.removeItem(MEETING_DESKTOP_CAST_KEY);
  globalThis.dispatchEvent?.(new Event('servant:meeting-desktop-cast-changed'));
}

export function newMeeting(main: CharacterProfile): MeetingSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: '新建讨论',
    goal: '',
    participants: [main.id],
    messages: [],
    queue: [],
    status: 'active',
    mode: 'manual',
    conclusions: [],
    tasks: [],
    summary: '',
    updatedAt: now
  };
}

/**
 * The card that actually drives one speaker in a multi-person meeting.
 *
 * Resolved the way the page always did — the person's own card, else the built-in
 * one, else nothing — and then run through {@link applyCharacterPromptSettings} so
 * the *global* additional prompt also reaches multi-person chat. Single-character
 * chat already folds it in via `useChatIdentity`; the meeting ran `card.config`
 * straight into the LLM, so the setting was silently ignored there.
 *
 * Read at call time (never cached in state) because the settings window is a
 * different webview: the next turn picks the value up from storage instead of
 * needing a cross-window event to be wired up.
 */
export function meetingSpeakerCard(
  cards: readonly (CharacterSkill & { id: string })[],
  profile: CharacterProfile,
  promptSettings: CharacterPromptSettings
): CharacterSkill {
  const card =
    cards.find((item) => item.id === profile.characterCardId) ??
    cards.find((item) => item.id === 'builtin') ??
    emptyCharacterSkill;
  return applyCharacterPromptSettings(card, promptSettings);
}

export function meetingContext(
  session: MeetingSession,
  people: readonly CharacterProfile[],
  userName = 'Master',
  currentSpeakerId = session.participants[0] ?? ''
): string {
  const names = new Map(people.map((profile) => [profile.id, profile.name]));
  const transcript = session.messages
    .slice(-20)
    .map(
      (message) =>
        `${
          message.senderId === 'user'
            ? `[用户 · ${userName}]`
            : `[角色 · ${names.get(message.senderId) ?? '已移除角色'} / ${message.senderId}]`
        }：${message.text}`
    );
  return [
    `发言身份规则：用户称呼为“${userName}”；本轮唯一应答角色是“${
      names.get(currentSpeakerId) ?? '角色'
    }”（角色 ID：${currentSpeakerId}）。`,
    `会议记录中的 [用户] 才是真人用户，[角色] 是其他 Agent 的历史发言。不得把用户说过的话、经历或身份写成当前角色自己的，也不得冒充其他角色；始终以当前应答角色的身份回复。`,
    `会议目标：${session.goal || '未指定'}`,
    `参与角色：${session.participants
      .map((id) => names.get(id))
      .filter(Boolean)
      .join('、')}`,
    session.conclusions.length ? `已确认结论：\n- ${session.conclusions.join('\n- ')}` : '',
    session.tasks.length ? `待办事项：\n- ${session.tasks.join('\n- ')}` : '',
    transcript.length ? `最近会议记录：\n${transcript.join('\n')}` : '',
    `你只代表当前角色发言。可在最后一个回复 JSON 对象中额外给出 next_speaker_id。候选编号：${session.participants.join(
      ', '
    )}。该字段是建议，会议调度器会校验。`
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * The one dialogue turn the character is asked to answer.
 *
 * The transcript itself travels as *text* inside {@link meetingContext}, where
 * every line is tagged `[用户]` or `[角色]`, so re-sending it here would only
 * duplicate it — and mapping teammates to `assistant` turns made a character
 * read their lines as its own words. What `messages` has to carry instead is an
 * anchor: a single `user` turn that says whose turn it is and what to answer.
 *
 * When nobody has spoken yet — a fresh session where the user pressed "全体讨论"
 * straight away — the meeting goal stands in, so the first speaker still has
 * something concrete to open on instead of the queue stalling silently.
 */
export function meetingTurnPrompt(
  session: MeetingSession,
  people: readonly CharacterProfile[],
  userName: string,
  speakerId: string
): ChatMessage {
  const speakerName =
    new Map(people.map((profile) => [profile.id, profile.name])).get(speakerId) ?? '当前角色';
  const lastUser = [...session.messages].reverse().find((message) => message.senderId === 'user');
  const goal = session.goal || '（暂未指定目标，请先提出一个可讨论的议题）';
  const text = lastUser
    ? `请你以「${speakerName}」的身份回应${userName}的最新发言，不要代替其他角色说话：\n${userName}：${lastUser.text}`
    : `目前还没有人发言。请你以「${speakerName}」的身份围绕会议目标开场：\n${goal}`;
  return {
    id: `turn-${speakerId}-${session.messages.length}`,
    role: 'user',
    text,
    createdAt: Date.now()
  };
}

export function searchMeetingHistory(
  sessions: readonly MeetingSession[],
  people: readonly CharacterProfile[],
  query: string
): MeetingSession[] {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return [...sessions];
  const names = new Map(people.map((profile) => [profile.id, profile.name]));
  return sessions.filter((session) =>
    [
      session.title,
      ...session.participants.map((id) => names.get(id) ?? ''),
      ...session.messages.map((message) => message.text)
    ].some((value) => value.toLocaleLowerCase().includes(term))
  );
}

function isMeeting(value: unknown): value is MeetingSession {
  if (!value || typeof value !== 'object') return false;
  const meeting = value as Partial<MeetingSession>;
  return (
    typeof meeting.id === 'string' &&
    typeof meeting.title === 'string' &&
    typeof meeting.goal === 'string' &&
    Array.isArray(meeting.participants) &&
    meeting.participants.every((id) => typeof id === 'string') &&
    Array.isArray(meeting.messages) &&
    meeting.messages.every(isMeetingMessage) &&
    Array.isArray(meeting.queue) &&
    meeting.queue.every((id) => typeof id === 'string') &&
    ['active', 'paused', 'ended'].includes(meeting.status as string) &&
    ['manual', 'all', 'auto'].includes(meeting.mode as string) &&
    Array.isArray(meeting.conclusions) &&
    Array.isArray(meeting.tasks) &&
    typeof meeting.summary === 'string' &&
    typeof meeting.updatedAt === 'number'
  );
}

/**
 * 表演字段是后加的，所以**旧记录里没有它们也必须能读进来**——把 `isMeeting`
 * 写成「这些字段也是 `string`/`number`」会让升级后每个人的聊天记录整场消失。
 * 只校验必需字段，可选的表演字段有则校验、无则放过。
 */
function isMeetingMessage(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<MeetingMessage>;
  return (
    typeof message.id === 'string' &&
    typeof message.senderId === 'string' &&
    typeof message.text === 'string' &&
    typeof message.createdAt === 'number' &&
    (message.emotion === undefined || typeof message.emotion === 'string') &&
    (message.intensity === undefined || typeof message.intensity === 'number') &&
    (message.shortAction === undefined || typeof message.shortAction === 'string') &&
    (message.estimatedDurationMs === undefined || typeof message.estimatedDurationMs === 'number')
  );
}
