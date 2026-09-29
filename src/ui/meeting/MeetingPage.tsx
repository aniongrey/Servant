import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Bot,
  Check,
  ChevronDown,
  Flag,
  Maximize2,
  MessageSquare,
  Minus,
  MonitorUp,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Square,
  Users,
  X
} from 'lucide-react';
import { AiSdkClient } from '../../ai/llm/AiSdkClient';
import { getActiveSpeechSdkTtsLanguage } from '../../ai/tts/speechSdkTtsConfig';
import { getSpokenReplySegments } from '../../ai/tts/resolveConversationSpeech';
import { loadCharacterVoiceConfigOrDefault } from '../../ai/tts/characterVoiceConfig';
import { buildTtsEmotionPrompt, resolveTtsEmotionMarkup } from '../../ai/tts/ttsEmotionMarkup';
import { useVoiceInput } from '../voice/useVoiceInput';
import { VoiceSendComposer } from '../voice/VoiceSendComposer';
import { VoiceRecipients } from '../voice/VoiceRecipients';
import { loadLlmConfig } from '../../ai/llm/LlmConfig';
import { loadCharacterSkillLibrary, loadCharacterPromptSettings } from '../../ai/personality/CharacterSkill';
import { createDefaultPersonalityState } from '../../ai/personality/PersonalitySystem';
import { createGlobalNetworkFetch } from '../../app/network/globalNetworkFetch';
import { loadUiPreferences } from '../../app/settings/uiPreferences';
import { loadMeetingUserName, MEETING_USER_NAME_KEY } from '../../app/settings/meetingUserName';
import { avatarImageSource } from '../../app/network/avatarImageClient';
import {
  hideCurrentDesktopWindow,
  isTauriDesktop,
  minimizeCurrentDesktopWindow,
  notifyMeetingReady,
  startDesktopWindowDrag,
  toggleMaximizeCurrentDesktopWindow
} from '../../desktop/tauri/navigation';
import {
  loadCharacterProfiles,
  saveCharacterProfiles,
  makeCharacterProfile,
  avatarFor,
  suggestedSpeakerId,
  type CharacterProfile
} from '../../character/characterProfiles';
import { Button, Dialog, TextAreaInput, TextInput } from '../shared/ServantControls';
import {
  newMeeting,
  loadMeetings,
  saveMeetings,
  meetingContext,
  meetingDeltaStart,
  meetingSpeakerCard,
  meetingTurnPrompt,
  nextAutoSpeaker,
  loadMeetingDesktopCast,
  searchMeetingHistory,
  setMeetingDesktopCast,
  loadMeetingAutoTurnLimit,
  saveMeetingAutoTurnLimit,
  MEETING_AUTO_TURN_LIMIT_KEY,
  MEETING_DESKTOP_CAST_KEY,
  MEETINGS_KEY,
  MEETINGS_DELETED_KEY,
  DEFAULT_AUTO_TURNS,
  type MeetingSession,
  type MeetingMessage,
  type MeetingMode
} from './meetingState';
import { playMeetingReply, meetingReplyPerformances, mergeReplyPerformances } from './meetingVoice';
import { typewriterTotalMs } from '../stage/typewriterTiming';
import { useTypewriter } from '../stage/useTypewriter';
import { publishStageReplying } from '../stage/stageReplyingChannel';
import { publishDesktopRealtimeSync } from '../../app/network/realtime/DesktopRealtimeSync';
import { isStageMeetingCommand, STAGE_MEETING_CHANNEL, type StageMeetingCommand } from './stageMeetingBridge';
import './meeting.css';

/**
 * 打字机铺完最后一个字之后，状态再多留一会儿。
 *
 * 最后那个字停一拍才被读到，立刻把「正在回复…」摘掉会显得它闪了一下就没了；
 * 留一小段时间让「说完」这件事看起来是收尾，而不是被打断。
 */
const TYPEWRITER_CLOSING_GRACE_MS = 420;
type MeetingDialogState =
  | {
      kind: 'text';
      title: string;
      description: string;
      placeholder: string;
      confirmLabel: string;
      onSubmit(value: string): void;
    }
  | { kind: 'confirm'; title: string; description: string; confirmLabel: string; onConfirm(): void };

export function MeetingPage() {
  const [profiles, setProfiles] = useState<CharacterProfile[]>(loadCharacterProfiles);
  const [sessions, setSessions] = useState<MeetingSession[]>(loadMeetings);
  const [selectedId, setSelectedId] = useState(sessions[0]?.id ?? '');
  const [cards, setCards] = useState<Awaited<ReturnType<typeof loadCharacterSkillLibrary>>['cards']>([]);
  const [query, setQuery] = useState('');
  const [input, setInput] = useState('');
  const [userName, setUserName] = useState(loadMeetingUserName);
  const [speakerId, setSpeakerId] = useState('');
  const [maxAutoTurns, setMaxAutoTurns] = useState(loadMeetingAutoTurnLimit);
  const [busy, setBusy] = useState(false);
  /**
   * 「正在整理想法…」只该在**等模型出稿**的那一小段显示。
   *
   * 从前它借用了 `busy`，而 `busy` 覆盖「等 LLM + 播语音」整个周期——于是文字
   * 铺完、`replying` 被定时器摘掉之后，语音还没播完、`busy` 仍为 true，界面就
   * 又冒回一句「正在整理想法…」，直到语音播完才消失。这里单独用一个 state，
   * 只在 `llm.chat` 的 await 期间为 true，拿到回复（`markReplying` 之前）即清。
   */
  const [thinking, setThinking] = useState(false);
  const thinkingCharacterId = useRef<string | null>(null);
  const [thinkingAgentId, setThinkingAgentId] = useState('');
  /**
   * 「正在回复…」的展示态：**由文字铺完结束，不由语音播完结束**。
   *
   * 从前界面读的是 `session.queue.length > 0`，而队列要等 `playMeetingReply`
   * （音频播完）才前进，于是合成/播放一慢，状态就多挂好几十秒。现在这里放的是
   * 一串定时器：每条消息按打字机时长排一个到期时间，全部到期即收尾。
   *
   * 不落库、不进 `session`：它是纯粹的瞬态视图状态，刷新后本来就该是「没人正在说」。
   */
  const [replying, setReplying] = useState<{ sessionId: string; senderId: string } | null>(null);
  const replyingTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const replyingCharacterId = useRef<string | null>(null);
  const [error, setError] = useState('');
  const [deleted, setDeleted] = useState<MeetingSession[]>(() => loadDeletedMeetings());
  const [showDeleted, setShowDeleted] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [dialog, setDialog] = useState<MeetingDialogState | null>(null);
  const [dialogValue, setDialogValue] = useState('');
  const [desktopCastId, setDesktopCastId] = useState(loadMeetingDesktopCast);
  const controller = useRef<AbortController | null>(null);
  const runningSessionId = useRef<string | null>(null);
  const sessionRef = useRef(sessions);
  const bottomRef = useRef<HTMLDivElement>(null);
  sessionRef.current = sessions;
  const selected = sessions.find((session) => session.id === selectedId) ?? null;
  const main = profiles.find((profile) => profile.isMain) ?? profiles[0];
  const people = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);
  const visibleSessions = sessions.filter(
    (session) =>
      session.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ||
      session.messages.some((message) => message.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  );
  const visibleDeleted = searchMeetingHistory(deleted, profiles, historyQuery);
  const desktopCastActive = selected?.id === desktopCastId;
  const stageCommandRef = useRef<(command: StageMeetingCommand) => void>(() => undefined);
  useEffect(() => {
    const channel = new BroadcastChannel(STAGE_MEETING_CHANNEL);
    channel.onmessage = ({ data }) => {
      if (typeof data?.requestId !== 'string' || !isStageMeetingCommand(data?.command)) return;
      try {
        stageCommandRef.current(data.command);
        channel.postMessage({ type: 'ack', requestId: data.requestId });
      } catch (cause) {
        channel.postMessage({ type: 'ack', requestId: data.requestId, error: cause instanceof Error ? cause.message : '操作失败' });
      }
    };
    return () => channel.close();
  }, []);
  useEffect(() => {
    void notifyMeetingReady().catch((cause) => {
      setError(cause instanceof Error ? cause.message : '桌面角色启动失败');
    });
  }, []);
  useEffect(() => {
    if (!error || !desktopCastId) return;
    const channel = new BroadcastChannel(STAGE_MEETING_CHANNEL);
    channel.postMessage({ type: 'error', sessionId: desktopCastId, error });
    channel.close();
  }, [error, desktopCastId]);

  useEffect(() => {
    const abort = new AbortController();
    void loadCharacterSkillLibrary(abort.signal)
      .then((library) => {
        if (!abort.signal.aborted) setCards(library.cards);
      })
      .catch(() => undefined);
    const syncProfiles = () => setProfiles(loadCharacterProfiles());
    const onStorage = (event: StorageEvent) => {
      if (event.key === MEETINGS_KEY) setSessions(loadMeetings());
      if (event.key === MEETING_AUTO_TURN_LIMIT_KEY) setMaxAutoTurns(loadMeetingAutoTurnLimit());
      if (event.key === MEETING_DESKTOP_CAST_KEY) setDesktopCastId(loadMeetingDesktopCast());
      if (event.key === 'servant.characterProfiles.v1') syncProfiles();
      if (event.key === MEETING_USER_NAME_KEY) setUserName(loadMeetingUserName());
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('servant:character-profiles-changed', syncProfiles);
    return () => {
      abort.abort();
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('servant:character-profiles-changed', syncProfiles);
    };
  }, []);

  useEffect(() => {
    const defaultSpeaker = main?.id ?? selected?.participants[0] ?? '';
    if (!speakerId || !selected?.participants.includes(speakerId)) setSpeakerId(defaultSpeaker);
  }, [main?.id, selected?.id, selected?.participants, speakerId]);

  useEffect(() => () => controller.current?.abort(), []);

  // 「正在回复…」的定时器活在这个组件里，卸载时必须收掉，否则会 setState 到已卸载的组件。
  useEffect(() => () => replyingTimers.current.forEach(clearTimeout), []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selected?.messages.length]);

  const commit = (update: (current: MeetingSession) => MeetingSession) => {
    if (!selected) return;
    const next = sessions.map((session) =>
      session.id === selected.id ? { ...update(session), updatedAt: Date.now() } : session
    );
    setSessions(next);
    saveMeetings(next);
  };

  const createSession = () => {
    if (!main) {
      const profile = makeCharacterProfile({ id: 'main', name: '主角色', isMain: true });
      const nextProfiles = [...profiles, profile];
      saveCharacterProfiles(nextProfiles);
      setProfiles(nextProfiles);
    }
    const session = newMeeting(main ?? makeCharacterProfile({ id: 'main', isMain: true }));
    const next = [session, ...sessions];
    setSessions(next);
    saveMeetings(next);
    setSelectedId(session.id);
    setError('');
  };

  /**
   * 开始「正在回复…」，并把它该结束的时刻排进定时器。
   *
   * 时长不是拍脑袋的常数，而是逐条按 `typewriterTotalMs` 累加——舞台那边每个字
   * 停多久，这里就按同样的算法等多久，所以文字一铺完状态就消失。
   */
  const markReplying = (sessionId: string, senderId: string, messages: readonly MeetingMessage[]) => {
    clearReplying();
    replyingCharacterId.current = senderId;
    publishDesktopRealtimeSync({ type: 'character-status', characterId: senderId, statuses: ['typing'] });
    setReplying({ sessionId, senderId });
    let elapsed = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const message of messages) {
      elapsed += typewriterTotalMs(message.text, message.estimatedDurationMs ?? 0);
      timers.push(setTimeout(clearReplying, elapsed + TYPEWRITER_CLOSING_GRACE_MS));
    }
    replyingTimers.current = timers;
    // 舞台窗口不在同一个 React 树里，状态得广播过去——它的对话框也要显示同一条
    // 「正在回复…」，而且同样要在文字铺完时消失。`elapsed` 就是两边共用的时长。
    publishStageReplying({ sessionId, senderId, phase: 'replying', until: Date.now() + elapsed + TYPEWRITER_CLOSING_GRACE_MS });
  };

  const clearReplying = () => {
    replyingTimers.current.forEach(clearTimeout);
    replyingTimers.current = [];
    if (replyingCharacterId.current) {
      publishDesktopRealtimeSync({ type: 'character-status', characterId: replyingCharacterId.current, statuses: [] });
      replyingCharacterId.current = null;
    }
    setReplying(null);
    publishStageReplying(null);
  };

  const clearThinking = () => {
    if (thinkingCharacterId.current) {
      publishDesktopRealtimeSync({ type: 'character-status', characterId: thinkingCharacterId.current, statuses: [] });
      publishStageReplying(null);
      thinkingCharacterId.current = null;
    }
    setThinking(false);
    setThinkingAgentId('');
  };

  const runQueue = async (
    sessionId: string,
    mode: MeetingMode,
    initialQueue: string[],
    autoTurnLimit = DEFAULT_AUTO_TURNS
  ) => {
    if ((controller.current && !controller.current.signal.aborted) || !initialQueue.length) return;
    const activeProfiles = profiles;
    let queue = [...new Set(initialQueue)].filter((id) =>
      activeProfiles.some((profile) => profile.id === id)
    );
    const current = sessionRef.current.find((item) => item.id === sessionId);
    if (!current || current.status !== 'active') return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    runningSessionId.current = sessionId;
    setBusy(true);
    setError('');
    let autoTurns = 0;
    try {
      while (queue.length && !abort.signal.aborted) {
        const live = sessionRef.current.find((item) => item.id === sessionId);
        if (!live || live.status !== 'active') break;
        const agentId = queue[0];
        const profile = activeProfiles.find((item) => item.id === agentId);
        if (!profile) {
          queue = queue.slice(1);
          continue;
        }
        const nextSessions = sessionRef.current.map((item) =>
          item.id === sessionId ? { ...item, queue, mode } : item
        );
        sessionRef.current = nextSessions;
        setSessions(nextSessions);
        saveMeetings(nextSessions);
        // Includes the global 「追加提示词」 setting, read fresh for every turn.
        const card = meetingSpeakerCard(cards, profile, loadCharacterPromptSettings());
        const config = loadLlmConfig();
        const preferences = loadUiPreferences();
        const llm = new AiSdkClient(
          config,
          createGlobalNetworkFetch({ proxyEnabled: preferences.proxyEnabled, proxyUrl: preferences.proxyUrl })
        );
        const ttsConfig = loadCharacterVoiceConfigOrDefault(profile.voiceId);
        const ttsEmotionMarkup = resolveTtsEmotionMarkup(ttsConfig);
        const history = [meetingTurnPrompt(live, activeProfiles, userName, agentId)];
        // 方案 B：system 只放 delta 之前的记录，delta 那一截由 `meetingTurnPrompt` 放进
        // 当前 user turn。同一段对话不在两个地方各写一遍，也不会随会议变长反复膨胀。
        const contextStart = meetingDeltaStart(live, agentId);
        // 多人链路不维护 PersonalityState、不消费 soulEvent、不落库 memories、也不带工具，
        // 所以把这四段从 system 里裁掉，避免留下占位死值（状态行恒为默认）与悬空工具条款。
        // 将来把单人能力迁进多人时，逐项打开这里的开关即可。
        setThinking(true);
        thinkingCharacterId.current = agentId;
        setThinkingAgentId(agentId);
        publishDesktopRealtimeSync({ type: 'character-status', characterId: agentId, statuses: ['thinking'] });
        publishStageReplying({ sessionId, senderId: agentId, phase: 'thinking' });
        const intent = await llm.chat(
          card.config,
          createDefaultPersonalityState(card.config),
          history,
          abort.signal,
          [
            meetingContext(live, activeProfiles, userName, profile.id, contextStart),
            buildTtsEmotionPrompt(ttsEmotionMarkup)
          ].filter(Boolean).join('\n'),
          undefined,
          { state: false, soulEvent: false, memories: false, tools: false }
        );
        if (abort.signal.aborted) break;
        const spokenReplies = await getSpokenReplySegments(
          llm,
          intent.replies,
          getActiveSpeechSdkTtsLanguage(ttsConfig),
          ttsEmotionMarkup,
          abort.signal
        );
        // 出稿了，「整理想法」到此为止；接下来交给 `markReplying` 的「正在回复…」，
        // 它由文字铺完（打字机）结束，不占用这里。
        setThinking(false);
        clearThinking();
        // LLM 的 `replies` 是**表演**粒度：一段自带 emotion / shortAction，舞台按段
        // 打一次字、换一次表情。但聊天列表是**阅读**的地方，一条回复就该是一个气泡，
        // 所以落库时把整轮合成一条（段间换行）。舞台那边吃的是逐段广播，粒度不受影响。
        const performances = meetingReplyPerformances(intent);
        if (performances.length) {
          // 先一次性把整轮消息落库，舞台才有完整文本可铺；随后再按段播语音。
          // 逐段落库是错的——第一段播完时队列还没走完，打字机会以为「说完了」。
          const first = performances[0];
          const merged: MeetingMessage = {
            id: crypto.randomUUID(),
            senderId: agentId,
            text: mergeReplyPerformances(performances),
            createdAt: Date.now(),
            emotion: first.emotion,
            intensity: first.intensity,
            shortAction: first.shortAction,
            // 时长按**整轮之和**算：打字机是逐字铺的，合并后铺的字数没变，总时长自然
            // 该是各段之和（`markReplying` 也照这个值排「正在回复…」的收尾时刻）。
            estimatedDurationMs: performances.reduce(
              (total, performance) => total + performance.estimatedDurationMs,
              0
            )
          };
          const updated = sessionRef.current.map((item) =>
            item.id === sessionId
              ? { ...item, messages: [...item.messages, merged], updatedAt: Date.now() }
              : item
          );
          sessionRef.current = updated;
          setSessions(updated);
          saveMeetings(updated);
          // 「正在回复…」由 `markReplying` 排的定时器自己收尾（文字铺完就结束），
          // 这里**不要**在语音 await 之后清它——那正是原来的 bug：状态被绑在音频上，
          // 合成一慢就多挂几十秒。音频播完只决定队列前进，不决定这句「说完没有」。
          markReplying(sessionId, agentId, [merged]);
          await playMeetingReply(
            `meeting-${merged.id}`,
            agentId,
            intent,
            abort.signal,
            spokenReplies.map((reply) => reply.spokenText)
          );
        }
        queue = queue.slice(1);
        autoTurns += 1;
        if (mode === 'auto' && autoTurns < autoTurnLimit) {
          const allowed = live.participants.filter(
            (id) => id !== agentId && activeProfiles.some((person) => person.id === id)
          );
          const suggestion = suggestedSpeakerId(llm.getLastRawOutput(), allowed);
          const nextSpeaker = nextAutoSpeaker(live, allowed, suggestion);
          if (nextSpeaker && !queue.includes(nextSpeaker)) queue.push(nextSpeaker);
        }
        const updated = sessionRef.current.map((item) =>
          item.id === sessionId ? { ...item, queue, mode, updatedAt: Date.now() } : item
        );
        sessionRef.current = updated;
        setSessions(updated);
        saveMeetings(updated);
      }
    } catch (cause) {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : '角色回复失败');
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        runningSessionId.current = null;
        setBusy(false);
        clearThinking();
        // 正常跑完时定时器早该全部到期了；被打断时（打断 / 暂停 / 关窗）队列里
        // 还没轮到的段落不会再说话，把它们排下的定时器一并收掉，否则界面会停在
        // 「正在回复…」直到那串定时器自己走完。
        clearReplying();
        const live = sessionRef.current.map((item) =>
          item.id === sessionId
            ? {
                ...item,
                queue: item.status === 'paused' ? item.queue : [],
                mode: 'manual' as const,
                updatedAt: Date.now()
              }
            : item
        );
        sessionRef.current = live;
        setSessions(live);
        saveMeetings(live);
      }
    }
  };

  const sendText = (value: string): boolean => {
    const text = value.trim();
    if (!selected || selected.status !== 'active' || !text || !main) return false;
    controller.current?.abort();
    clearThinking();
    const userMessage: MeetingMessage = {
      id: crypto.randomUUID(),
      senderId: 'user',
      text,
      createdAt: Date.now()
    };
    const targets = [speakerId || main.id].filter((id) => selected.participants.includes(id));
    if (!targets.length) return false;
    const updated = sessions.map((session) =>
      session.id === selected.id
        ? {
            ...session,
            messages: [...session.messages, userMessage],
            queue: targets,
            updatedAt: Date.now()
          }
        : session
    );
    setSessions(updated);
    sessionRef.current = updated;
    saveMeetings(updated);
    setInput('');
    void runQueue(selected.id, 'manual', targets);
    return true;
  };
  const send = (event?: FormEvent) => { event?.preventDefault(); sendText(input); };
  const runSessionControl = (sessionId: string, action: 'continue' | 'all' | 'auto' | 'pause') => {
    const session = sessionRef.current.find((item) => item.id === sessionId);
    if (!session || session.status === 'ended') throw new Error('这场对话已结束。');
    if (action === 'pause') {
      if (runningSessionId.current === sessionId) {
        controller.current?.abort();
        clearThinking();
        clearReplying();
      }
      const updated = sessionRef.current.map((item) => item.id === sessionId ? { ...item, status: 'paused' as const, updatedAt: Date.now() } : item);
      sessionRef.current = updated; setSessions(updated); saveMeetings(updated);
    } else if (action === 'continue') {
      const queue = session.queue.length ? session.queue : [main?.id].filter((id): id is string => Boolean(id));
      const updated = sessionRef.current.map((item) => item.id === sessionId ? { ...item, status: 'active' as const, updatedAt: Date.now() } : item);
      sessionRef.current = updated; setSessions(updated); saveMeetings(updated);
      if (queue.length) setTimeout(() => void runQueue(sessionId, 'manual', queue), 0);
    } else if (action === 'all') {
      if (session.status !== 'active') throw new Error('对话已暂停，请先继续讨论。');
      void runQueue(sessionId, 'all', session.participants);
    } else {
      if (session.status !== 'active') throw new Error('对话已暂停，请先继续讨论。');
      const lastSpeaker = [...session.messages].reverse().find((message) => message.senderId !== 'user')?.senderId;
      const allowed = session.participants.filter((id) => id !== lastSpeaker);
      const next = nextAutoSpeaker(session, allowed.length ? allowed : session.participants);
      if (next) void runQueue(sessionId, 'auto', [next], loadMeetingAutoTurnLimit());
    }
  };
  stageCommandRef.current = (command) => {
    const current = sessionRef.current.find((item) => item.id === command.sessionId);
    if (!current || current.status === 'ended') throw new Error('这场对话已结束。');
    if (command.type === 'interrupt') { interruptSession(command.sessionId); return; }
    if (command.type === 'control') { runSessionControl(command.sessionId, command.action); return; }
    if (controller.current && !controller.current.signal.aborted) throw new Error('角色正在回复，请等回复结束或先打断。');
    if (command.type === 'participant') {
      const profile = profiles.find((item) => item.id === command.characterId);
      if (!profile) throw new Error('角色不存在。');
      if (profile.isMain && current.participants.includes(profile.id)) throw new Error('请保留主角色。');
      if (!current.participants.includes(profile.id) && current.participants.length >= 8) throw new Error('最多支持 8 位角色。');
      const participants = current.participants.includes(profile.id) ? current.participants.filter((id) => id !== profile.id) : [...current.participants, profile.id];
      const updated = sessionRef.current.map((item) => item.id === current.id ? { ...item, participants, updatedAt: Date.now() } : item);
      sessionRef.current = updated; setSessions(updated); saveMeetings(updated);
      return;
    }
    if (current.status !== 'active') throw new Error('对话已暂停，请在多人对话中恢复。');
    if (!current.participants.includes(command.speakerId)) throw new Error('请选择参与对话的角色。');
    const message: MeetingMessage = { id: crypto.randomUUID(), senderId: 'user', text: command.text.trim(), createdAt: Date.now() };
    const updated = sessionRef.current.map((item) => item.id === current.id
      ? { ...item, messages: [...item.messages, message], queue: [command.speakerId], updatedAt: Date.now() } : item);
    sessionRef.current = updated; setSessions(updated); saveMeetings(updated);
    void runQueue(current.id, 'manual', [command.speakerId]);
  };
  const toggleParticipant = (id: string) =>
    commit((session) => {
      if (session.participants.includes(id))
        return {
          ...session,
          participants: session.participants.filter((item) => item !== id),
          queue: session.queue.filter((item) => item !== id)
        };
      return { ...session, participants: [...session.participants, id] };
    });
  const toggleDesktopCast = () => {
    if (!selected) return;
    const next = desktopCastActive ? null : selected.id;
    setMeetingDesktopCast(next);
    setDesktopCastId(next);
  };
  const allDiscuss = () => selected && runSessionControl(selected.id, 'all');
  const autoDiscuss = () => selected && runSessionControl(selected.id, 'auto');
  const pause = () => selected && runSessionControl(selected.id, 'pause');
  const resume = () => selected && runSessionControl(selected.id, 'continue');
  const interruptSession = (sessionId: string) => {
    if (runningSessionId.current === sessionId) {
      controller.current?.abort();
      clearThinking();
    }
    const updated = sessionRef.current.map((session) => session.id === sessionId ? { ...session, queue: [] } : session);
    sessionRef.current = updated; setSessions(updated); saveMeetings(updated);
  };
  const interrupt = () => { if (selected) interruptSession(selected.id); };
  const voice = useVoiceInput({
    target: selected?.status === 'active' && selected.participants.includes(speakerId) ? {
      page: 'meeting', sessionId: selected.id, characterId: speakerId,
      label: selected.title + ' · ' + (people.get(speakerId)?.name ?? '角色')
    } : null,
    input, setInput,
    interrupt,
    send: async (text) => {
      if (controller.current && !controller.current.signal.aborted) return false;
      return sendText(text);
    }
  });
  const end = () => {
    controller.current?.abort();
    clearThinking();
    if (desktopCastActive) toggleDesktopCast();
    commit((session) => ({
      ...session,
      status: 'ended',
      queue: [],
      summary: session.messages
        .slice(-8)
        .map(
          (message) =>
            `${message.senderId === 'user' ? '用户' : people.get(message.senderId)?.name ?? '角色'}：${
              message.text
            }`
        )
        .join('\n')
    }));
  };
  const rename = () => {
    if (!selected) return;
    setDialogValue(selected.title);
    setDialog({
      kind: 'text',
      title: '重命名对话',
      description: '为这场讨论设置一个容易识别的名称。',
      placeholder: '输入对话名称',
      confirmLabel: '保存',
      onSubmit: (title) => commit((session) => ({ ...session, title }))
    });
  };
  const removeSession = () => {
    if (!selected) return;
    if (busy) {
      controller.current?.abort();
      clearThinking();
    }
    if (desktopCastActive) toggleDesktopCast();
    const next = sessions.filter((session) => session.id !== selected.id);
    const removed = [selected, ...deleted];
    setDeleted(removed);
    localStorage.setItem(MEETINGS_DELETED_KEY, JSON.stringify(removed));
    setSessions(next);
    saveMeetings(next);
    setSelectedId(next[0]?.id ?? '');
  };
  const deleteSession = () => {
    if (!selected) return;
    setDialog({
      kind: 'confirm',
      title: '删除对话',
      description: `确定删除“${selected.title}”？删除后仍可从历史恢复。`,
      confirmLabel: '删除',
      onConfirm: removeSession
    });
  };
  const restoreSession = (session: MeetingSession) => {
    const next = [session, ...sessions];
    const restored = deleted.filter((item) => item.id !== session.id);
    setSessions(next);
    saveMeetings(next);
    setDeleted(restored);
    localStorage.setItem(MEETINGS_DELETED_KEY, JSON.stringify(restored));
    setSelectedId(session.id);
    setShowDeleted(false);
    setHistoryQuery('');
  };
  const setGoal = (goal: string) => commit((session) => ({ ...session, goal }));
  const addConclusion = () => {
    setDialogValue('');
    setDialog({
      kind: 'text',
      title: '添加已确认结论',
      description: '记录讨论中已经达成一致的结论。',
      placeholder: '输入结论',
      confirmLabel: '添加',
      onSubmit: (value) => commit((session) => ({ ...session, conclusions: [...session.conclusions, value] }))
    });
  };
  const addTask = () => {
    setDialogValue('');
    setDialog({
      kind: 'text',
      title: '添加待办事项',
      description: '记录讨论后需要跟进的行动。',
      placeholder: '输入待办事项',
      confirmLabel: '添加',
      onSubmit: (value) => commit((session) => ({ ...session, tasks: [...session.tasks, value] }))
    });
  };
  const submitDialog = () => {
    if (!dialog) return;
    if (dialog.kind === 'text') {
      const value = dialogValue.trim();
      if (!value) return;
      dialog.onSubmit(value);
    } else dialog.onConfirm();
    setDialog(null);
  };

  return (
    <>
      <main className="meeting-app">
        <header
          className="meeting-titlebar"
          onPointerDown={(event) => {
            if (event.button === 0 && !(event.target as Element).closest('button'))
              void startDesktopWindowDrag();
          }}
          onDoubleClick={(event) => {
            if (!(event.target as Element).closest('button')) void toggleMaximizeCurrentDesktopWindow();
          }}
        >
          <div className="meeting-titlebar-brand">
            <MessageSquare size={17} />
            <strong>多人聊天</strong>
            <span>MEETING ROOM</span>
          </div>
          {isTauriDesktop() ? (
            <div className="meeting-window-controls" aria-label="窗口控制">
              <button
                aria-label="最小化"
                onClick={() => void minimizeCurrentDesktopWindow()}
                title="最小化"
                type="button"
              >
                <Minus size={15} />
              </button>
              <button
                aria-label="最大化或还原"
                onClick={() => void toggleMaximizeCurrentDesktopWindow()}
                title="最大化 / 还原"
                type="button"
              >
                <Maximize2 size={14} />
              </button>
              <button
                aria-label="隐藏多人对话"
                onClick={() => void hideCurrentDesktopWindow()}
                title="隐藏到桌面"
                type="button"
              >
                <X size={16} />
              </button>
            </div>
          ) : null}
        </header>
        <aside className="meeting-sidebar">
          <div className="meeting-side-title">
            <MessageSquare size={18} />
            <div>
              <strong>讨论列表</strong>
              <span>MEETINGS</span>
            </div>
          </div>
          <Button className="meeting-primary" onClick={createSession} type="button" variant="primary">
            <Plus size={16} />
            新建对话
          </Button>
          <label className="meeting-search">
            <Search size={15} />
            <TextInput
              placeholder="搜索对话"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <div className="meeting-session-list">
            {visibleSessions.map((session) => (
              <button
                className="meeting-session"
                data-active={selected?.id === session.id}
                key={session.id}
                onClick={() => setSelectedId(session.id)}
                type="button"
              >
                <strong>{session.title}</strong>
                <span>
                  {session.participants.length} 位角色 · {new Date(session.updatedAt).toLocaleDateString()}
                </span>
                <small>
                  {session.status === 'ended' ? '已结束' : session.status === 'paused' ? '已暂停' : '进行中'}
                </small>
              </button>
            ))}
          </div>
          <div className="meeting-side-footer">
            <button className="meeting-history-open" onClick={() => setShowDeleted(true)} type="button">
              <RotateCcw size={14} />
              历史恢复 <small>{deleted.length}</small>
            </button>
          </div>
        </aside>
        {!selected ? (
          <section className="meeting-empty">
            <Users size={30} />
            <h1>开始一场多人讨论</h1>
            <p>新建后默认与主角色聊天，再邀请其他角色加入。</p>
            <Button className="meeting-primary" onClick={createSession} type="button" variant="primary">
              <Plus size={16} />
              新建对话
            </Button>
          </section>
        ) : (
          <>
            <section className="meeting-main">
              <header className="meeting-top">
                <div>
                  <span>当前讨论</span>
                  <Button
                    className="meeting-title-button"
                    onClick={rename}
                    title="重命名"
                    type="button"
                    variant="quiet"
                  >
                    {selected.title} <ChevronDown size={14} />
                  </Button>
                </div>
                <div className="meeting-participants">
                  <span>参与角色 {selected.participants.length}/8</span>
                  {profiles.map((profile) => (
                    <button
                      className="meeting-person-chip"
                      data-joined={selected.participants.includes(profile.id)}
                      disabled={profile.isMain && selected.participants.includes(profile.id)}
                      key={profile.id}
                      onClick={() => toggleParticipant(profile.id)}
                      title={`${selected.participants.includes(profile.id) ? '移除' : '邀请'}${profile.name}`}
                      type="button"
                    >
                      <i>
                        <img
                          src={avatarImageSource(profile.avatarId, avatarFor(profile.avatarId).image)}
                          alt=""
                        />
                      </i>
                      {profile.name}
                    </button>
                  ))}
                </div>
              </header>
              <div className="meeting-transcript">
                {selected.messages.length ? (
                  selected.messages.map((message, index) => {
                    const speaker = message.senderId === 'user' ? null : people.get(message.senderId);
                    /**
                     * 只给**最后一条**、而且是**这一轮正在回复的那条**做逐字揭示。
                     *
                     * 为什么要和舞台一样「伪输入」：聊天列表里一个字都不铺就整段
                     * 弹出来，跟舞台对白框一边打字一边演会对不上拍；看起来像消息早已
                     * 写好、只是舞台在慢慢念。让列表也逐字长出来，两处才是同一句话的
                     * 同一种呈现。历史消息（在下面 `index` 靠前）一律即时铺满——
                     * 重新打开窗口时不该把旧对话再打一遍。
                     */
                    const typing =
                      Boolean(replying) &&
                      replying?.sessionId === selected.id &&
                      replying?.senderId === message.senderId &&
                      index === selected.messages.length - 1;
                    return (
                      <MeetingMessageBubble
                        key={message.id}
                        message={message}
                        speakerName={speaker?.name ?? userName}
                        avatar={speaker ? (
                          <img
                            src={avatarImageSource(speaker.avatarId, avatarFor(speaker.avatarId).image)}
                            alt=""
                          />
                        ) : (
                          userName.slice(0, 1)
                        )}
                        typing={typing}
                      />
                    );
                  })
                ) : (
                  <div className="meeting-welcome">
                    <Bot size={26} />
                    <h2>讨论目标是什么？</h2>
                    <p>先在输入框上方选择说话对象，再发送消息；全体讨论会让当前参与角色依次发言。</p>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
              {error ? (
                <p className="meeting-error" role="alert">
                  {error}
                </p>
              ) : null}
              <VoiceSendComposer voice={voice} input={input} setInput={setInput} onSubmit={send}
                disabled={selected.status === 'ended'} placeholder="输入消息…"
                recipients={<VoiceRecipients profiles={selected.participants.map((id) => people.get(id)).filter((profile): profile is CharacterProfile => Boolean(profile))}
                  selectedId={speakerId} onSelect={setSpeakerId}
                  status={replying && replying.sessionId === selected.id ? (
                    <span className="meeting-inline-status" data-phase="replying"><i />{people.get(replying.senderId)?.name ?? '角色'}正在回复…</span>
                  ) : thinking ? (
                    <span className="meeting-inline-status" data-phase="thinking"><i />{people.get(thinkingAgentId)?.name ?? '角色'}正在整理想法…</span>
                  ) : undefined} />} />
            </section>
            <aside className="meeting-controls">
              <section>
                <h2>讨论控制</h2>
                <div className="meeting-control-grid">
                  <Button
                    aria-pressed={desktopCastActive}
                    className="meeting-desktop-cast-toggle"
                    data-active={desktopCastActive}
                    disabled={selected.status === 'ended'}
                    onClick={toggleDesktopCast}
                    title={desktopCastActive ? '收回桌面上的会议角色' : '在桌面显示当前参与角色'}
                    type="button"
                  >
                    <MonitorUp size={14} />
                    {desktopCastActive ? '退出舞台模式' : '打开舞台模式'}
                  </Button>
                  <Button disabled={selected.status !== 'active'} onClick={pause} type="button">
                    <Pause size={15} />
                    暂停
                  </Button>
                  <Button
                    disabled={selected.status !== 'paused'}
                    onClick={resume}
                    type="button"
                    variant="primary"
                  >
                    <Play size={15} />
                    继续讨论
                  </Button>
                  <Button
                    disabled={selected.status === 'ended'}
                    onClick={interrupt}
                    type="button"
                    variant="danger"
                  >
                    <Square size={15} />
                    打断发言
                  </Button>
                  <Button disabled={selected.status !== 'active'} onClick={allDiscuss} type="button">
                    <Users size={15} />
                    全体讨论
                  </Button>
                  <Button disabled={selected.status !== 'active'} onClick={autoDiscuss} type="button">
                    <Bot size={15} />
                    自动选择
                  </Button>
                  <label className="meeting-auto-turn-limit">
                    自动选择最大轮数
                    <TextInput
                      aria-label="自动选择最大轮数"
                      type="number"
                      min={1}
                      max={99}
                      step={1}
                      value={maxAutoTurns}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) setMaxAutoTurns(saveMeetingAutoTurnLimit(value));
                      }}
                    />
                  </label>
                  <Button disabled={selected.status === 'ended'} onClick={end} type="button" variant="danger">
                    <Flag size={15} />
                    结束讨论
                  </Button>
                </div>
              </section>
              <section>
                <h2>发言队列</h2>
                {busy ? (
                  <p className="meeting-current">
                    <i />
                    {profiles.find((profile) => selected.queue[0] === profile.id)?.name ?? '角色'}正在发言
                  </p>
                ) : (
                  <p className="meeting-muted">等待用户选择下一位</p>
                )}
                {replying && replying.sessionId === selected.id ? (
                  <p className="meeting-muted">
                    {people.get(replying.senderId)?.name ?? '角色'}的文字正在铺开，听完这轮语音后自动进入下一位
                  </p>
                ) : null}
                {selected.queue.map((id, index) => (
                  <p className="meeting-queue-item" key={`${id}-${index}`}>
                    {index + 1}. {people.get(id)?.name ?? '已移除角色'}
                  </p>
                ))}
              </section>
              <section>
                <h2>讨论目标</h2>
                <TextAreaInput
                  maxLength={500}
                  onChange={(event) => setGoal(event.currentTarget.value)}
                  placeholder="填写本次讨论要解决的问题"
                  value={selected.goal}
                />
              </section>
              <section>
                <div className="meeting-section-title">
                  <h2>已确认结论</h2>
                  <Button onClick={addConclusion} type="button" variant="quiet">
                    添加
                  </Button>
                </div>
                {selected.conclusions.map((item, index) => (
                  <p className="meeting-result" key={`${item}-${index}`}>
                    <Check size={14} />
                    {item}
                  </p>
                ))}
                {selected.conclusions.length === 0 ? <p className="meeting-muted">暂未记录</p> : null}
              </section>
              <section>
                <div className="meeting-section-title">
                  <h2>待办事项</h2>
                  <Button onClick={addTask} type="button" variant="quiet">
                    添加
                  </Button>
                </div>
                {selected.tasks.map((item, index) => (
                  <p className="meeting-result" key={`${item}-${index}`}>
                    □ {item}
                  </p>
                ))}
                {selected.tasks.length === 0 ? <p className="meeting-muted">暂未记录</p> : null}
              </section>
              {selected.summary ? (
                <section>
                  <h2>讨论总结</h2>
                  <p className="meeting-summary">{selected.summary}</p>
                </section>
              ) : null}
              <div className="meeting-control-footer">
                <span>{voicesLabel(people, selected.participants)}</span>
                <Button aria-label="删除对话" onClick={deleteSession} type="button" variant="danger">
                  <X size={15} />
                  删除对话
                </Button>
              </div>
            </aside>
          </>
        )}
      </main>
      {dialog ? (
        <Dialog
          className="meeting-dialog"
          description={dialog.kind === 'text' ? dialog.description : undefined}
          onClose={() => setDialog(null)}
          title={dialog.title}
          actions={
            <>
              <Button onClick={() => setDialog(null)} type="button">
                取消
              </Button>
              <Button
                disabled={dialog.kind === 'text' && !dialogValue.trim()}
                onClick={submitDialog}
                type="button"
                variant={dialog.confirmLabel === '删除' ? 'danger' : 'primary'}
              >
                {dialog.confirmLabel}
              </Button>
            </>
          }
        >
          {dialog.kind === 'text' ? (
            <TextInput
              autoFocus
              maxLength={dialog.title === '重命名对话' ? 60 : 500}
              onChange={(event) => setDialogValue(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitDialog();
                }
              }}
              placeholder={dialog.placeholder}
              value={dialogValue}
            />
          ) : (
            <p className="meeting-dialog-description">{dialog.description}</p>
          )}
        </Dialog>
      ) : null}
      {showDeleted ? (
        <Dialog
          className="meeting-history-dialog"
          description="删除的对话会暂存在这里，恢复后会重新出现在左侧列表，并立即打开。"
          onClose={() => setShowDeleted(false)}
          title={`历史恢复 · ${deleted.length} 条`}
          actions={
            <Button onClick={() => setShowDeleted(false)} type="button" variant="quiet">
              关闭
            </Button>
          }
        >
          <label className="meeting-history-search">
            <Search size={16} />
            <TextInput
              autoFocus
              onChange={(event) => setHistoryQuery(event.currentTarget.value)}
              placeholder="搜索标题、角色或聊天内容…"
              value={historyQuery}
            />
          </label>
          {visibleDeleted.length ? (
            <div className="meeting-history-list">
              {visibleDeleted.map((session) => {
                const last = session.messages[session.messages.length - 1];
                const lastSpeaker = last
                  ? last.senderId === 'user'
                    ? userName
                    : people.get(last.senderId)?.name ?? '已移除角色'
                  : '';
                return (
                  <article className="meeting-history-item" key={session.id}>
                    <div className="meeting-history-item-copy">
                      <strong>{session.title}</strong>
                      <p>{last ? `${lastSpeaker}：${last.text}` : '暂无聊天内容'}</p>
                      <div>
                        <span>{session.participants.length} 位角色</span>
                        <span>{session.messages.length} 条消息</span>
                        <time>{new Date(session.updatedAt).toLocaleString()}</time>
                      </div>
                    </div>
                    <Button onClick={() => restoreSession(session)} type="button" variant="primary">
                      <RotateCcw size={14} />
                      恢复并打开
                    </Button>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="meeting-history-empty">
              <RotateCcw size={24} />
              <strong>{deleted.length ? '没有匹配的对话' : '这里还没有可恢复的对话'}</strong>
              <span>
                {deleted.length ? '试试其他标题、角色名或关键词。' : '删除对话后，会暂存在这里供你恢复。'}
              </span>
            </div>
          )}
        </Dialog>
      ) : null}
    </>
  );
}

function loadDeletedMeetings(): MeetingSession[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(MEETINGS_DELETED_KEY) ?? '[]');
    return Array.isArray(value)
      ? value.filter(
          (item): item is MeetingSession =>
            item &&
            typeof item.id === 'string' &&
            typeof item.title === 'string' &&
            Array.isArray(item.messages)
        )
      : [];
  } catch {
    return [];
  }
}

function voicesLabel(people: Map<string, CharacterProfile>, participants: string[]) {
  const count = participants.filter((id) => people.get(id)?.voiceId).length;
  return `已绑定音色 ${count}/${participants.length}`;
}

/**
 * 聊天列表里的一条消息。
 *
 * 平时是静态气泡；只有「这一轮正在回复的最后一条」才走逐字揭示（`typing`），
 * 揭示速度用同一份 `typewriterTotalMs`——与舞台对白框、以及多人窗口自己排
 * 「正在回复…」收尾时刻的算法完全一致，所以三处会同时铺完、同时收尾。
 * 时长取 `estimatedDurationMs`，那是整轮的语音预估（合并消息时已按段求和）。
 */
function MeetingMessageBubble({ message, speakerName, avatar, typing }: {
  message: MeetingMessage;
  speakerName: string;
  avatar: ReactNode;
  typing: boolean;
}) {
  const typed = useTypewriter(message.text, {
    durationMs: message.estimatedDurationMs ?? 0,
    enabled: typing
  });
  return (
    <article className="meeting-message" data-user={message.senderId === 'user'} data-typing={typing && !typed.done}>
      <div className="meeting-message-avatar">{avatar}</div>
      <div>
        <header>
          <strong>{speakerName}</strong>
          <time>
            {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </time>
        </header>
        <p>{typing ? typed.shown : message.text}</p>
      </div>
    </article>
  );
}
