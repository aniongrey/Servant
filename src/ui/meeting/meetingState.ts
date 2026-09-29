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
export const MEETING_AUTO_TURN_LIMIT_KEY = 'servant.meetingAutoTurnLimit.v1';
export const DEFAULT_AUTO_TURNS = 8;
export type MeetingStatus = 'active' | 'paused' | 'ended';
export type MeetingMode = 'manual' | 'all' | 'auto';

export function loadMeetingAutoTurnLimit(): number {
  try {
    const value = Number(localStorage.getItem(MEETING_AUTO_TURN_LIMIT_KEY));
    return Number.isFinite(value) && value > 0 ? Math.max(1, Math.min(99, Math.floor(value))) : DEFAULT_AUTO_TURNS;
  } catch {
    return DEFAULT_AUTO_TURNS;
  }
}

export function saveMeetingAutoTurnLimit(value: number): number {
  const limit = Number.isFinite(value) ? Math.max(1, Math.min(99, Math.floor(value))) : DEFAULT_AUTO_TURNS;
  try { localStorage.setItem(MEETING_AUTO_TURN_LIMIT_KEY, String(limit)); } catch { /* unavailable storage */ }
  return limit;
}

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

/**
 * 该角色「已经读到哪一条」——也就是他最后一次发言所在的下标，从未发言返回 `-1`。
 *
 * 方案里叫 `lastReadIndex`，但**不需要额外持久化**：角色一开口，那条消息就紧跟在当前
 * 末尾落库，所以「他上次读到哪」恒等于「他最后一条发言的下标」，从 `messages` 反查即可。
 * 这样旧会议记录不用迁移，也不会出现游标和消息表对不上的漂移。
 */
export function speakerCursor(session: MeetingSession, speakerId: string): number {
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    if (session.messages[index].senderId === speakerId) return index;
  }
  return -1;
}

/** 一次最多喂多少条「你错过的讨论」。角色第一次发言时会拿到这么多条历史。 */
export const MEETING_DELTA_LIMIT = 12;

/**
 * 自该角色上次发言以来，会议新增的消息。
 *
 * 从未发言的角色没有游标，退化为「最近 {@link MEETING_DELTA_LIMIT} 条」——不把整场历史
 * 灌进去，长会议会把这一轮撑爆。
 *
 * 措辞上它不是「角色没看过的信息」：每轮都是一次全新 LLM 调用，没有任何跨轮阅读状态。
 * 它表示的是「你上次发言之后，会议又发生了这些」。
 */
export function meetingDelta(
  session: MeetingSession,
  speakerId: string,
  limit = MEETING_DELTA_LIMIT
): MeetingMessage[] {
  const cursor = speakerCursor(session, speakerId);
  const pending = cursor < 0 ? session.messages : session.messages.slice(cursor + 1);
  return limit > 0 ? pending.slice(-limit) : [...pending];
}

/** delta 的起始下标——`meetingContext` 用它把 delta 那一段排除在 system 之外。 */
export function meetingDeltaStart(
  session: MeetingSession,
  speakerId: string,
  limit = MEETING_DELTA_LIMIT
): number {
  return session.messages.length - meetingDelta(session, speakerId, limit).length;
}

/**
 * 本轮真正要接的那一句。
 *
 * delta 只回答「他错过了什么」，模型还得知道「现在该接谁」。没有这个区分，模型会试图
 * 把 delta 里每个人的话各回一遍，回复变得又长又散。
 */
export function meetingTarget(session: MeetingSession, speakerId: string): MeetingMessage | null {
  const delta = meetingDelta(session, speakerId);
  const inDelta = [...delta].reverse().find((message) => message.senderId !== speakerId);
  if (inDelta) return inDelta;
  // 空 delta = 自己就是最后发言人（队列里连着排了同一个人）。回退到最后一句别人的话，
  // 一句都没有则返回 null，由 `meetingTurnPrompt` 退回会议目标开场。
  return [...session.messages].reverse().find((message) => message.senderId !== speakerId) ?? null;
}

/** 最近发过言的角色，最近的排前面；用户不算。 */
function recentSpeakerIds(session: MeetingSession, limit: number): string[] {
  const seen: string[] = [];
  for (let index = session.messages.length - 1; index >= 0 && seen.length < limit; index -= 1) {
    const id = session.messages[index].senderId;
    if (id !== 'user' && !seen.includes(id)) seen.push(id);
  }
  return seen;
}

/**
 * 自动讨论的调度器：只回答「下一个谁说」，不碰内容。
 *
 * 兜底走 LRU —— 取「最后一次发言最靠前」的人，从未发言（游标 `-1`）最优先，同分按
 * 名单顺序。原来的 `allowed[0]` 是「名单里第一个不是当前发言人的人」，三人会议会退化成
 * 前两人来回，第三人一次都轮不到。
 *
 * LLM 的 `next_speaker_id` 仍然优先，但加了**回弹抑制**：把话又丢回上一个发言人
 * （A→B→A）时改走 LRU，否则模型一句「你说得对」就能把会议锁死在两个人身上。
 */
export function nextAutoSpeaker(
  session: MeetingSession,
  candidateIds: readonly string[],
  suggestion?: string | null
): string | undefined {
  const candidates = [...new Set(candidateIds)].filter((id) => session.participants.includes(id));
  if (!candidates.length) return undefined;
  // 禁止 A→A：刚发过言的人这一轮直接出局。单人会议没人可换时再把他放回来，
  // 否则调度器返回 undefined，队列会静默停下。
  const justSpoke = [...session.messages].reverse().find((message) => message.senderId !== 'user')?.senderId;
  const fresh = candidates.filter((id) => id !== justSpoke);
  const usable = fresh.length ? fresh : candidates;
  const leastRecent = usable.reduce((best, id) =>
    speakerCursor(session, id) < speakerCursor(session, best) ? id : best
  );
  if (suggestion && usable.includes(suggestion) && suggestion !== recentSpeakerIds(session, 2)[1]) {
    return suggestion;
  }
  return leastRecent;
}

export function meetingContext(
  session: MeetingSession,
  people: readonly CharacterProfile[],
  userName = 'Master',
  currentSpeakerId = session.participants[0] ?? '',
  beforeIndex = session.messages.length
): string {
  const names = new Map(people.map((profile) => [profile.id, profile.name]));
  // 方案 B：delta 那一截走当前 user turn，这里只放它**之前**的记录，同一段对话不在
  // 两个地方各写一遍。`beforeIndex` 默认到末尾，行为与改之前一致。
  const head = session.messages.slice(0, Math.max(0, Math.min(beforeIndex, session.messages.length)));
  const hasDelta = head.length < session.messages.length;
  const transcript = head
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
    transcript.length ? `${hasDelta ? '更早的会议记录' : '最近会议记录'}：\n${transcript.join('\n')}` : '',
    `你只代表当前角色发言。可在最后一个回复 JSON 对象中额外给出 next_speaker_id。${
      hasDelta ? '本轮要接续的内容不在这里，见当前发言。' : ''
    }候选编号：${session.participants.join(', ')}。该字段是建议，会议调度器会校验。`
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * The one dialogue turn the character is asked to answer.
 *
 * It used to be a single line quoting the *user's* last message, which made every
 * speaker in a queue answer the same sentence and left anyone who joined later with
 * no idea what the others had said in between. It now carries two separate things:
 *
 * - {@link meetingDelta} — what happened after this character last spoke, so it can
 *   pick the discussion back up instead of restarting from the user's question.
 * - {@link meetingTarget} — the one line it should actually answer, because handing
 *   over a block of messages without naming the focus makes a model reply to each
 *   of them in turn.
 *
 * Both travel as *text* inside a single `user` turn. Mapping teammates to `assistant`
 * turns made a character read their lines as its own words, and the transcript itself
 * already lives in {@link meetingContext}.
 *
 * When nobody else has spoken yet — a fresh session where the user pressed "全体讨论"
 * straight away — the meeting goal stands in, so the first speaker still has
 * something concrete to open on instead of the queue stalling silently.
 */
export function meetingTurnPrompt(
  session: MeetingSession,
  people: readonly CharacterProfile[],
  userName: string,
  speakerId: string
): ChatMessage {
  const names = new Map(people.map((profile) => [profile.id, profile.name]));
  const speakerName = names.get(speakerId) ?? '当前角色';
  const label = (message: MeetingMessage) =>
    message.senderId === 'user'
      ? `[用户 · ${userName}]`
      : `[角色 · ${names.get(message.senderId) ?? '已移除角色'} / ${message.senderId}]`;
  const target = meetingTarget(session, speakerId);
  const goal = session.goal || '（暂未指定目标，请先提出一个可讨论的议题）';
  const text = target
    ? [
        `请你以「${speakerName}」的身份继续参与这场多人讨论，不要代替其他角色说话。`,
        meetingDeltaSection(session, speakerId, label),
        `【当前讨论焦点】\n${label(target)}：${target.text}`,
        [
          '【你的任务】',
          '优先回应当前讨论焦点，并结合你错过的其他内容。',
          '不要机械重复别人或自己已经说过的观点；确实没有可补充时，自然地提出一个新的相关观点。'
        ].join('\n')
      ].join('\n\n')
    : `目前还没有人发言。请你以「${speakerName}」的身份围绕会议目标开场：\n${goal}`;
  return {
    id: `turn-${speakerId}-${session.messages.length}`,
    role: 'user',
    text,
    createdAt: Date.now()
  };
}

function meetingDeltaSection(
  session: MeetingSession,
  speakerId: string,
  label: (message: MeetingMessage) => string
): string {
  const delta = meetingDelta(session, speakerId);
  return delta.length
    ? `【你上次发言之后，会议新增了以下内容】\n${delta
        .map((message) => `${label(message)}：${message.text}`)
        .join('\n')}`
    : '【你上次发言之后，会议还没有新的讨论】';
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
