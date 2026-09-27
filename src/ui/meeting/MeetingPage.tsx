import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Bot,
  Check,
  ChevronDown,
  Flag,
  Maximize2,
  MessageSquare,
  Mic,
  Minus,
  MonitorUp,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Send,
  Square,
  Users,
  X
} from 'lucide-react';
import { AiSdkClient } from '../../ai/llm/AiSdkClient';
import { SherpaSpeechRecognition } from '../../ai/stt/SherpaSpeechRecognition';
import { loadLlmConfig } from '../../ai/llm/LlmConfig';
import { loadCharacterSkillLibrary, emptyCharacterSkill } from '../../ai/personality/CharacterSkill';
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
  meetingTurnPrompt,
  loadMeetingDesktopCast,
  searchMeetingHistory,
  setMeetingDesktopCast,
  MEETING_DESKTOP_CAST_KEY,
  MEETINGS_KEY,
  MEETINGS_DELETED_KEY,
  type MeetingSession,
  type MeetingMessage,
  type MeetingMode
} from './meetingState';
import { playMeetingReply } from './meetingVoice';
import { isStageMeetingCommand, STAGE_MEETING_CHANNEL, type StageMeetingCommand } from './stageMeetingBridge';
import './meeting.css';

const MAX_AUTO_TURNS = 8;
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
  const [speechStatus, setSpeechStatus] = useState<'idle' | 'initializing' | 'listening' | 'transcribing'>(
    'idle'
  );
  const [speakerId, setSpeakerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleted, setDeleted] = useState<MeetingSession[]>(() => loadDeletedMeetings());
  const [showDeleted, setShowDeleted] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [dialog, setDialog] = useState<MeetingDialogState | null>(null);
  const [dialogValue, setDialogValue] = useState('');
  const [desktopCastId, setDesktopCastId] = useState(loadMeetingDesktopCast);
  const controller = useRef<AbortController | null>(null);
  const speechRecognition = useMemo(() => new SherpaSpeechRecognition(), []);
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

  useEffect(() => {
    let disposed = false;
    void speechRecognition.preload().catch((cause) => {
      if (!disposed && speechRecognition.isSupported())
        setError(cause instanceof Error ? cause.message : '本地语音模型预加载失败');
    });
    return () => {
      disposed = true;
    };
  }, [speechRecognition]);

  useEffect(
    () => () => {
      controller.current?.abort();
      speechRecognition.destroy();
    },
    [speechRecognition]
  );

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

  const runQueue = async (sessionId: string, mode: MeetingMode, initialQueue: string[]) => {
    if ((controller.current && !controller.current.signal.aborted) || !initialQueue.length) return;
    const activeProfiles = profiles;
    let queue = [...new Set(initialQueue)].filter((id) =>
      activeProfiles.some((profile) => profile.id === id)
    );
    const current = sessionRef.current.find((item) => item.id === sessionId);
    if (!current || current.status !== 'active') return;
    setMeetingDesktopCast(sessionId);
    setDesktopCastId(sessionId);
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
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
        const card =
          cards.find((item) => item.id === profile.characterCardId) ??
          cards.find((item) => item.id === 'builtin') ??
          emptyCharacterSkill;
        const config = loadLlmConfig();
        const preferences = loadUiPreferences();
        const llm = new AiSdkClient(
          config,
          createGlobalNetworkFetch({ proxyEnabled: preferences.proxyEnabled, proxyUrl: preferences.proxyUrl })
        );
        const history = [meetingTurnPrompt(live, activeProfiles, userName, agentId)];
        const intent = await llm.chat(
          card.config,
          createDefaultPersonalityState(card.config),
          history,
          abort.signal,
          meetingContext(live, activeProfiles, userName, profile.id)
        );
        if (abort.signal.aborted) break;
        const text = intent.speech.trim();
        if (text) {
          const reply: MeetingMessage = {
            id: crypto.randomUUID(),
            senderId: agentId,
            text,
            createdAt: Date.now()
          };
          const updated = sessionRef.current.map((item) =>
            item.id === sessionId
              ? { ...item, messages: [...item.messages, reply], updatedAt: Date.now() }
              : item
          );
          sessionRef.current = updated;
          setSessions(updated);
          saveMeetings(updated);
          await playMeetingReply(`meeting-${reply.id}`, agentId, intent, abort.signal);
        }
        queue = queue.slice(1);
        autoTurns += 1;
        if (mode === 'auto' && autoTurns < MAX_AUTO_TURNS) {
          const allowed = live.participants.filter(
            (id) => id !== agentId && activeProfiles.some((person) => person.id === id)
          );
          const suggestion = suggestedSpeakerId(llm.getLastRawOutput(), allowed);
          const nextSpeaker = suggestion ?? allowed[0];
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
        setBusy(false);
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

  const send = (event?: FormEvent) => {
    event?.preventDefault();
    const text = input.trim();
    if (!selected || selected.status !== 'active' || !text || !main) return;
    if (speechStatus !== 'idle') {
      speechRecognition.abort();
      setSpeechStatus('idle');
    }
    controller.current?.abort();
    const userMessage: MeetingMessage = {
      id: crypto.randomUUID(),
      senderId: 'user',
      text,
      createdAt: Date.now()
    };
    const targets = [speakerId || main.id].filter((id) => selected.participants.includes(id));
    if (!targets.length) return;
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
  };
  stageCommandRef.current = (command) => {
    const current = sessionRef.current.find((item) => item.id === command.sessionId);
    if (!current || current.status === 'ended') throw new Error('这场对话已结束。');
    if (command.type === 'interrupt') { controller.current?.abort(); return; }
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
  const toggleSpeechInput = () => {
    if (speechStatus === 'listening') {
      if (speechRecognition.finishCurrentUtterance()) setSpeechStatus('transcribing');
      return;
    }
    if (speechStatus !== 'idle' || !speechRecognition.isSupported()) return;
    setError('');
    setSpeechStatus('initializing');
    speechRecognition.startContinuous({
      mode: 'manual',
      onTranscript: (text, final) => {
        if (final && text)
          setInput((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}${text}`);
      },
      onStarted: () => setSpeechStatus('listening'),
      onError: (cause) => {
        setError(cause.message);
        setSpeechStatus('idle');
      },
      onEnd: () => setSpeechStatus('idle')
    });
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
  const allDiscuss = () => selected && runQueue(selected.id, 'all', selected.participants);
  const autoDiscuss = () => {
    if (!selected || !selected.participants.length) return;
    const lastSpeaker = [...selected.messages]
      .reverse()
      .find((message) => message.senderId !== 'user')?.senderId;
    const start = Math.max(0, selected.participants.indexOf(lastSpeaker ?? ''));
    const next = selected.participants[(start + 1) % selected.participants.length];
    void runQueue(selected.id, 'auto', [next]);
  };
  const pause = () => commit((session) => ({ ...session, status: 'paused' }));
  const resume = () => {
    if (!selected) return;
    const queue = selected.queue.length
      ? selected.queue
      : [main?.id].filter((id): id is string => Boolean(id));
    commit((session) => ({ ...session, status: 'active' }));
    if (queue.length) setTimeout(() => void runQueue(selected.id, 'manual', queue), 0);
  };
  const interrupt = () => {
    controller.current?.abort();
    commit((session) => ({ ...session, queue: [] }));
  };
  const end = () => {
    controller.current?.abort();
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
    if (busy) controller.current?.abort();
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
                  selected.messages.map((message) => {
                    const speaker = message.senderId === 'user' ? null : people.get(message.senderId);
                    return (
                      <article
                        className="meeting-message"
                        data-user={message.senderId === 'user'}
                        key={message.id}
                      >
                        <div className="meeting-message-avatar">
                          {speaker ? (
                            <img
                              src={avatarImageSource(speaker.avatarId, avatarFor(speaker.avatarId).image)}
                              alt=""
                            />
                          ) : (
                            userName.slice(0, 1)
                          )}
                        </div>
                        <div>
                          <header>
                            <strong>{speaker?.name ?? userName}</strong>
                            <time>
                              {new Date(message.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </time>
                          </header>
                          <p>{message.text}</p>
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <div className="meeting-welcome">
                    <Bot size={26} />
                    <h2>讨论目标是什么？</h2>
                    <p>先在输入框上方选择说话对象，再发送消息；全体讨论会让当前参与角色依次发言。</p>
                  </div>
                )}
                {busy ? (
                  <div className="meeting-thinking">
                    <span />
                    {profiles.find((profile) => selected.queue[0] === profile.id)?.name ?? '角色'}
                    正在整理想法…
                  </div>
                ) : null}
                <div ref={bottomRef} />
              </div>
              {error ? (
                <p className="meeting-error" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="meeting-speaker-picker" aria-label="选择说话对象">
                <span>说话对象</span>
                {selected.participants.map((id) => {
                  const profile = people.get(id);
                  if (!profile) return null;
                  return (
                    <button
                      className="meeting-person-chip"
                      data-selected={speakerId === id}
                      key={id}
                      onClick={() => setSpeakerId(id)}
                      type="button"
                    >
                      {profile.name}
                    </button>
                  );
                })}
              </div>
              <form className="meeting-composer" onSubmit={send}>
                <div className="meeting-composer-entry">
                  <TextInput
                    disabled={selected.status === 'ended'}
                    maxLength={4000}
                    onChange={(event) => setInput(event.currentTarget.value)}
                    placeholder="输入消息…"
                    value={input}
                  />
                </div>
                <Button
                  aria-label={speechStatus === 'listening' ? '结束录音并转写' : '语音转文字'}
                  disabled={
                    !speechRecognition.isSupported() ||
                    selected.status === 'ended' ||
                    speechStatus === 'initializing' ||
                    speechStatus === 'transcribing'
                  }
                  onClick={toggleSpeechInput}
                  title={
                    !speechRecognition.isSupported()
                      ? '当前环境不支持本地语音识别'
                      : speechStatus === 'listening'
                      ? '结束录音并转写'
                      : speechStatus === 'transcribing'
                      ? '正在识别语音…'
                      : '本地 SenseVoice 语音转文字'
                  }
                  type="button"
                  variant={speechStatus === 'listening' ? 'danger' : 'secondary'}
                >
                  {speechStatus === 'listening' ? <Square size={16} /> : <Mic size={17} />}
                </Button>
                <Button
                  aria-label="发送"
                  disabled={!input.trim() || selected.status === 'ended'}
                  type="submit"
                  variant="primary"
                >
                  <Send size={17} />
                </Button>
              </form>
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
                    {desktopCastActive ? '收起 Galgame 舞台' : '打开 Galgame 舞台'}
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
                  <Button
                    disabled={selected.status === 'ended' || selected.status === 'paused'}
                    onClick={resume}
                    type="button"
                    variant="primary"
                  >
                    <Play size={15} />
                    继续讨论
                  </Button>
                  <Button disabled={selected.status !== 'active'} onClick={allDiscuss} type="button">
                    <Users size={15} />
                    全体讨论
                  </Button>
                  <Button disabled={selected.status !== 'active'} onClick={autoDiscuss} type="button">
                    <Bot size={15} />
                    自动选择
                  </Button>
                  <Button disabled={selected.status !== 'active'} onClick={pause} type="button">
                    <Pause size={15} />
                    暂停
                  </Button>
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
