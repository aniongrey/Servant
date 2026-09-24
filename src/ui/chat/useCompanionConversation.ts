import { usePushToTalk } from './usePushToTalk';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearChatHistory, loadChatHistory } from '../../ai/memory/MemoryClient';
import { loadMemoryLlmConfig, MEMORY_LLM_CONFIG_STORAGE_KEY } from '../../ai/memory/MemoryLlmConfig';
import { applyAssistantPresentation, applyUserInteraction } from '../../ai/personality/PersonalitySystem';
import { SherpaSpeechRecognition } from '../../ai/stt/SherpaSpeechRecognition';
import type { ChatMessage, ConversationPhase, PersonalityMood } from '../../ai/llm/types';
import { getQueuedSegmentDelayMs } from '../../ai/llm/replyDelivery';
import { publishVoiceBroadcast } from '../../ai/tts/voiceBroadcast';
import { cancelChatTurn, requestDailyMemoryJob, submitChatTurn } from '../../app/network/chatApi';
import { loadWebSearchEnabled, saveWebSearchEnabled } from '../../app/network/webSearchSettings';
import {
  RealtimeGatewayClient,
  type RealtimeConnectionState
} from '../../app/network/realtime/RealtimeGatewayClient';
import { ACTION_VOICE_TOPIC, parseVoiceStreamEvent } from '../../app/network/realtime/VoiceStreamProtocol';
import {
  CHAT_TEXT_TOPIC,
  parseChatStreamEvent,
  type ChatTurnMeta
} from '../../app/network/realtime/ChatStreamProtocol';
import {
  parseDesktopRealtimeSyncEvent,
  publishDesktopRealtimeSync
} from '../../app/network/realtime/DesktopRealtimeSync';
import type { SchedulerTask, ToolResultEvent } from '../../scheduler/SchedulerTypes';
import type { SoulManager, SoulNeed } from '../../soul';
import type { CharacterActivityStatus } from '../../character/interaction/CharacterInteractionController';
import { applyMoodPresentation } from '../../character/expression/moodPresentation';

import { type CompanionChatPanelProps, type VoiceTimingState, type MessageSource, type ChatHistoryNotice } from './chatTypes';
import { createMessage, nowMs } from './chatPresentation';
import {
  CHAT_CONTEXT_SETTINGS_CHANGED_EVENT,
  loadChatContextMessageLimit
} from './chatContextSettings';
import { CHAT_CONTEXT_MESSAGE_LIMIT_STORAGE_KEY } from '../../app/settings/storageKeys';
import { useChatModels } from './useChatModels';
import { useChatIdentity } from './useChatIdentity';
import {
  MISSED_REMINDERS_CHANGED_EVENT,
  MISSED_REMINDER_STORAGE_KEY,
  saveMissedReminder,
  takeMissedReminders
} from '../../desktop/tauri/MissedReminderInbox';
import {
  formatShortcut,
  loadVoiceSettings,
  VOICE_SETTINGS_CHANGED_EVENT,
  VOICE_SETTINGS_STORAGE_KEY
} from '../../ai/voice/VoiceSettings';

const LLM_TURN_TIMEOUT_MS = 20_000;
const OLLAMA_TURN_TIMEOUT_MS = 60_000;
/** After the server confirms a turn (turn-start) the LLM may take longer; the
 * server's own 120s hygiene timeout broadcasts turn-error before this fires. */
const TURN_RUNNING_TIMEOUT_MS = 90_000;
const DESKTOP_SPEECH_SAFETY_MS = 120_000;
/** How long "没有更多了" stays up before it fades, plus the fade itself. */
const HISTORY_END_NOTICE_VISIBLE_MS = 3_000;
const HISTORY_END_NOTICE_FADE_MS = 240;

interface PendingTurnSegment {
  readonly index: number;
  readonly message: ChatMessage;
  readonly emotion: PersonalityMood;
  readonly intensity: number;
}

/**
 * One server-orchestrated turn in flight on this client. Segments arrive as
 * soon as the server computes them; `queue` paces their display so the reply
 * keeps the pre-existing typing rhythm without holding the turn watchdog.
 */
interface PendingTurn {
  readonly turnId: string;
  readonly userText: string;
  readonly source: MessageSource;
  readonly startedAt: number;
  readonly delivered: ChatMessage[];
  readonly queue: PendingTurnSegment[];
  displayTimer: number | null;
  voiceStarted: boolean;
  running: boolean;
  /** Set by `turn-end`: no further segment can arrive, so the queue stops pacing. */
  finished: boolean;
  meta: ChatTurnMeta | null;
  lastPresentation: { emotion: PersonalityMood; intensity: number } | null;
  watchdog: number;
}

export function useCompanionConversation({
  engine,
  ttsLanguage,
  ttsEmotionMarkup,
  networkFetch,
  llmConfig,
  onLlmConfigChange,
  speechRecognition: providedSpeechRecognition
}: CompanionChatPanelProps) {
  const defaultSpeechRecognition = useMemo(() => new SherpaSpeechRecognition(), []);
  const speechRecognition = providedSpeechRecognition ?? defaultSpeechRecognition;
  const realtimeClient = useMemo(() => new RealtimeGatewayClient(), []);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef(messages);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [hasOlderMessages, setHasOlderMessages] = useState(true);
  const [asrReady, setAsrReady] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState(loadVoiceSettings);
  const [contextMessageLimit, setContextMessageLimit] = useState(loadChatContextMessageLimit);
  // "没有更多了" is hidden by default: it is only shown when a gesture or a
  // finished page actually confirms the top, then it fades out by itself.
  const [historyEndNoticeId, setHistoryEndNoticeId] = useState(0);
  const [historyEndNoticeVisible, setHistoryEndNoticeVisible] = useState(false);

  const [input, setInput] = useState('');

  const [phase, setPhase] = useState<ConversationPhase>('idle');
  const [searching, setSearching] = useState(false);

  const [error, setError] = useState('');
  const { activeLlmConfig, updateLlmConfig, llm, models, llmOnline, setLlmOnline } = useChatModels({
    networkFetch,
    llmConfig,
    onLlmConfigChange
  });
  const [memoryLlmConfig, setMemoryLlmConfig] = useState(loadMemoryLlmConfig);
  const {
    personality,
    setPersonality,
    characterSkill,
    characterSkillError,
    skillMessage,
    skillInputRef,
    resetPersonality,
    importCharacterCard
  } = useChatIdentity(setError);
  const [currentNeed, setCurrentNeed] = useState<SoulNeed>(() => engine.soul.getState().currentNeed);

  useEffect(() => {
    if (!characterSkill) return;
    const storageKey = `soul-state:${characterSkill.config.id}`;
    const syncNeed = () => {
      engine.soul.load();
      setCurrentNeed(engine.soul.getState().currentNeed);
    };
    syncNeed();
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === storageKey) syncNeed();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [characterSkill?.config.id, engine.soul]);

  const [desktopTtsSpeaking, setDesktopTtsSpeaking] = useState(false);

  const [realtimeMicEnabled, setRealtimeMicEnabled] = useState(false);
  const [realtimeState, setRealtimeState] = useState<RealtimeConnectionState>('disconnected');
  const [webSearchEnabled, setWebSearchEnabledState] = useState(false);

  const [lastVoiceTimings, setLastVoiceTimings] = useState<VoiceTimingState | null>(null);
  const [llmFirstSpeechMs, setLlmFirstSpeechMs] = useState<number | null>(null);
  const [speechPlaybackStartMs, setSpeechPlaybackStartMs] = useState<number | null>(null);

  const interactionRunRef = useRef(0);
  const seenRealtimeMessageIdsRef = useRef(new Set<string>());
  const historyEndNoticeVisibleRef = useRef(false);
  const historyEndNoticeTimerRef = useRef<number | null>(null);

  const realtimeMicRef = useRef(false);

  const phaseRef = useRef<ConversationPhase>('idle');

  const voiceTranscriptRef = useRef('');

  const realtimeRestartTimerRef = useRef<number | null>(null);

  const sendTextRef = useRef<(text: string, source?: MessageSource) => Promise<void>>(async () => undefined);

  const activeDesktopSpeechIdRef = useRef<string | null>(null);
  const desktopSpeechSafetyTimerRef = useRef<number | null>(null);
  const speechTimingRef = useRef<{ id: string; startedAt: number } | null>(null);
  const pendingTurnRef = useRef<PendingTurn | null>(null);
  const personalityRef = useRef(personality);

  useEffect(() => {
    personalityRef.current = personality;
  }, [personality]);

  const clearDesktopSpeechSafetyTimer = useCallback(() => {
    if (desktopSpeechSafetyTimerRef.current !== null) {
      window.clearTimeout(desktopSpeechSafetyTimerRef.current);
      desktopSpeechSafetyTimerRef.current = null;
    }
  }, []);

  const appendMessage = useCallback((message: ChatMessage) => {
    if (seenRealtimeMessageIdsRef.current.has(message.id)) return;
    seenRealtimeMessageIdsRef.current.add(message.id);
    const history = [...messagesRef.current, message];
    messagesRef.current = history;
    setMessages(history);
  }, []);

  /**
   * Shows "没有更多了" for three seconds, then hides it. Repeat triggers while it
   * is still up are ignored instead of restarting the clock, so slowly scrolling
   * at the top of the list cannot pin the hint on screen.
   */
  const revealHistoryEnd = useCallback(() => {
    if (historyEndNoticeVisibleRef.current) return;
    historyEndNoticeVisibleRef.current = true;
    setHistoryEndNoticeId((current) => current + 1);
    setHistoryEndNoticeVisible(true);
    if (historyEndNoticeTimerRef.current !== null) window.clearTimeout(historyEndNoticeTimerRef.current);
    historyEndNoticeTimerRef.current = window.setTimeout(() => {
      historyEndNoticeTimerRef.current = null;
      historyEndNoticeVisibleRef.current = false;
      setHistoryEndNoticeVisible(false);
    }, HISTORY_END_NOTICE_VISIBLE_MS + HISTORY_END_NOTICE_FADE_MS);
  }, []);

  const cancelDesktopSpeech = useCallback(() => {
    clearDesktopSpeechSafetyTimer();
    const id = activeDesktopSpeechIdRef.current;
    activeDesktopSpeechIdRef.current = null;
    setDesktopTtsSpeaking(false);
    if (id) publishVoiceBroadcast({ type: 'speech-cancel', id, source: 'conversation' }, realtimeClient);
    engine.interaction.onSpeechEnd();
  }, [clearDesktopSpeechSafetyTimer, engine, realtimeClient]);

  const abandonPendingTurn = useCallback((): PendingTurn | null => {
    const pending = pendingTurnRef.current;
    pendingTurnRef.current = null;
    if (!pending) return null;
    window.clearTimeout(pending.watchdog);
    if (pending.displayTimer !== null) window.clearTimeout(pending.displayTimer);
    return pending;
  }, []);

  /** Arms the turn watchdog: tight before the server confirms, lenient after. */
  const armTurnWatchdog = useCallback(
    (turn: PendingTurn, budgetMs: number) => {
      window.clearTimeout(turn.watchdog);
      turn.watchdog = window.setTimeout(() => {
        if (pendingTurnRef.current?.turnId !== turn.turnId) return;
        abandonPendingTurn();
        cancelChatTurn(realtimeClient, turn.turnId);
        cancelDesktopSpeech();
        setError('请求已取消或 LLM 响应超时。');
        setPhase('error');
      }, budgetMs);
    },
    [abandonPendingTurn, cancelChatTurn, cancelDesktopSpeech, realtimeClient]
  );

  /** Cancels the active server-side turn plus local reply/speech state. */
  const interruptActiveTurn = useCallback(() => {
    const pending = abandonPendingTurn();
    if (pending) cancelChatTurn(realtimeClient, pending.turnId);
    cancelDesktopSpeech();
    setSearching(false);
  }, [abandonPendingTurn, cancelDesktopSpeech, realtimeClient]);

  /** Applies the turn meta once every segment has been displayed. */
  const finishDisplayedTurn = useCallback(
    (turn: PendingTurn) => {
      if (pendingTurnRef.current === turn) pendingTurnRef.current = null;
      window.clearTimeout(turn.watchdog);
      if (turn.displayTimer !== null) {
        window.clearTimeout(turn.displayTimer);
        turn.displayTimer = null;
      }
      if (turn.lastPresentation) {
        setPersonality(applyAssistantPresentation(personalityRef.current, turn.lastPresentation));
      }
      if (turn.meta) recordLlmSoulEvent(engine.soul, turn.meta.soulEvent, turn.userText);
      if (turn.source === 'voice') {
        const llmResponseMs = Math.max(0, nowMs() - turn.startedAt);
        setLastVoiceTimings((current) => (current ? { ...current, llmResponseMs } : current));
      }
      setLlmOnline(true);
      setSearching(false);
      setPhase(realtimeMicRef.current ? 'listening' : 'idle');
      // Keep the "speaking" state until the desktop reports playback completion.
      clearDesktopSpeechSafetyTimer();
      desktopSpeechSafetyTimerRef.current = window.setTimeout(() => {
        if (activeDesktopSpeechIdRef.current !== turn.turnId) return;
        activeDesktopSpeechIdRef.current = null;
        setDesktopTtsSpeaking(false);
        engine.interaction.onSpeechEnd();
      }, DESKTOP_SPEECH_SAFETY_MS);
    },
    [clearDesktopSpeechSafetyTimer, engine, setLlmOnline, setPersonality]
  );

  /** Displays each server segment exactly once. */
  const scheduleTurnDisplay = useCallback(
    (turn: PendingTurn, immediate = false) => {
      if (turn.displayTimer !== null) return;
      const showNext = () => {
        turn.displayTimer = null;
        const segment = turn.queue.shift();
        if (segment) {
          appendMessage(segment.message);
          turn.delivered.push(segment.message);
          turn.lastPresentation = { emotion: segment.emotion, intensity: segment.intensity };
          applyMoodPresentation(engine, segment.emotion, segment.intensity);
          if (pendingTurnRef.current === turn) setPhase('typing');
        }
        const next = turn.queue[0];
        if (!next) {
          turn.displayTimer = null;
          if (turn.finished) finishDisplayedTurn(turn);
          return;
        }
        const delay = getQueuedSegmentDelayMs(next.message.text, next.index, turn.finished);
        if (delay > 0) turn.displayTimer = window.setTimeout(showNext, delay);
        else showNext();
      };
      const first = turn.queue[0];
      if (!first) return;
      const delay = immediate ? 0 : getQueuedSegmentDelayMs(first.message.text, first.index, turn.finished);
      if (delay > 0) turn.displayTimer = window.setTimeout(showNext, delay);
      else showNext();
    },
    [appendMessage, engine, finishDisplayedTurn]
  );

  /**
   * `turn-end` just arrived: the queue only holds segments the server will never
   * add to, so a pacing wait started before it is now pointless — drop it and
   * drain what is left at burst speed.
   */
  const flushPacingWait = useCallback(
    (turn: PendingTurn) => {
      if (turn.displayTimer !== null) {
        window.clearTimeout(turn.displayTimer);
        turn.displayTimer = null;
      }
      scheduleTurnDisplay(turn, true);
    },
    [scheduleTurnDisplay]
  );

  useEffect(() => {
    let active = true;
    void loadChatHistory()
      .then((page) => {
        if (!active) return;
        setMessages((current) => {
          const ids = new Set(page.messages.map((message) => message.id));
          const merged = [...page.messages, ...current.filter((message) => !ids.has(message.id))];
          messagesRef.current = merged;
          return merged;
        });
        setHasOlderMessages(page.hasMore);
      })
      .catch((cause) => console.warn('Chat history loading failed', cause))
      .finally(() => active && setHistoryLoading(false));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const reload = () => setVoiceSettings(loadVoiceSettings());
    const storage = (event: StorageEvent) => {
      if (!event.key || event.key === VOICE_SETTINGS_STORAGE_KEY) reload();
    };
    window.addEventListener('storage', storage);
    window.addEventListener(VOICE_SETTINGS_CHANGED_EVENT, reload);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener(VOICE_SETTINGS_CHANGED_EVENT, reload);
    };
  }, []);

  useEffect(() => {
    const reload = () => setContextMessageLimit(loadChatContextMessageLimit());
    const storage = (event: StorageEvent) => {
      if (!event.key || event.key === CHAT_CONTEXT_MESSAGE_LIMIT_STORAGE_KEY) reload();
    };
    window.addEventListener('storage', storage);
    window.addEventListener(CHAT_CONTEXT_SETTINGS_CHANGED_EVENT, reload);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener(CHAT_CONTEXT_SETTINGS_CHANGED_EVENT, reload);
    };
  }, []);

  const loadOlderMessages = useCallback(async () => {
    if (historyLoading || !hasOlderMessages) return;
    const oldest = messagesRef.current[0];
    if (!oldest) return;
    setHistoryLoading(true);
    try {
      const page = await loadChatHistory(oldest);
      setMessages((current) => {
        const ids = new Set(current.map((message) => message.id));
        const merged = [...page.messages.filter((message) => !ids.has(message.id)), ...current];
        messagesRef.current = merged;
        return merged;
      });
      setHasOlderMessages(page.hasMore);
      // The last page is the one case where the end is worth announcing: the
      // user asked for more and there is none.
      if (!page.hasMore) revealHistoryEnd();
    } catch (cause) {
      console.warn('Older chat history loading failed', cause);
    } finally {
      setHistoryLoading(false);
    }
  }, [hasOlderMessages, historyLoading, revealHistoryEnd]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const reload = (event: StorageEvent) => {
      if (!event.key || event.key === MEMORY_LLM_CONFIG_STORAGE_KEY)
        setMemoryLlmConfig(loadMemoryLlmConfig());
    };
    window.addEventListener('storage', reload);
    return () => window.removeEventListener('storage', reload);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void requestDailyMemoryJob(memoryLlmConfig, controller.signal).catch((cause) =>
      console.warn('Daily memory job skipped', cause)
    );
    return () => controller.abort();
  }, [memoryLlmConfig]);

  useEffect(() => {
    const offState = realtimeClient.onStateChange(setRealtimeState);
    realtimeClient.connect();
    return () => {
      interruptActiveTurn();
      offState();
      realtimeClient.close();
    };
  }, [interruptActiveTurn, realtimeClient]);

  useEffect(
    () =>
      realtimeClient.on('desktop.sync', (payload) => {
        const event = parseDesktopRealtimeSyncEvent(payload);
        if (!event) return;
        if (event.type === 'tool-result') {
          if (seenRealtimeMessageIdsRef.current.has(event.requestId)) return;
          seenRealtimeMessageIdsRef.current.add(event.requestId);
          // Successful orchestrated tool payloads are raw data. The turn itself
          // renders and speaks the character-authored continuation.
          if (event.success && (event.tool === 'web-search' || event.requestId.startsWith('scheduler-')))
            return;
          appendMessage(createToolResultChatMessage(event));
          return;
        }
        if (event.type === 'reminder') {
          if (event.missed) {
            saveMissedReminder(event);
            return;
          }
          const messageId = `reminder-${event.jobId}-${event.dueAt}`;
          if (seenRealtimeMessageIdsRef.current.has(messageId)) return;
          seenRealtimeMessageIdsRef.current.add(messageId);
          const history = [...messagesRef.current, createMessage('assistant', `提醒：${event.message}`)];
          messagesRef.current = history;
          setMessages(history);
          return;
        }
      }),
    [appendMessage, realtimeClient]
  );

  // Dual stream, text side: the server-orchestrated transcript of every turn.
  useEffect(() => {
    const isActiveTurn = (turnId: string) => pendingTurnRef.current?.turnId === turnId;
    return realtimeClient.on(CHAT_TEXT_TOPIC, (payload) => {
      const event = parseChatStreamEvent(payload);
      if (!event) return;
      if (event.type === 'turn-start') {
        const turn = pendingTurnRef.current;
        if (turn && turn.turnId === event.turnId && !turn.running) {
          turn.running = true;
          // The turn is confirmed and streaming; give slow LLMs room.
          armTurnWatchdog(turn, TURN_RUNNING_TIMEOUT_MS);
        }
        if (event.userMessage.kind !== 'system') appendMessage(event.userMessage);
        setInput((current) => (current.trim() === event.userMessage.text ? '' : current));
        return;
      }
      if (event.type === 'turn-phase') {
        if (isActiveTurn(event.turnId)) setSearching(event.searching);
        return;
      }
      if (event.type === 'turn-segment') {
        const turn = pendingTurnRef.current;
        if (!turn || turn.turnId !== event.turnId) {
          appendMessage(event.message);
          return;
        }
        if (!turn.voiceStarted) {
          turn.voiceStarted = true;
          activeDesktopSpeechIdRef.current = event.turnId;
          setDesktopTtsSpeaking(true);
          if (speechTimingRef.current?.id === event.turnId) {
            setLlmFirstSpeechMs(Math.max(0, nowMs() - speechTimingRef.current.startedAt));
          }
        }
        turn.queue.push({
          index: event.index,
          message: event.message,
          emotion: event.emotion,
          intensity: event.intensity
        });
        scheduleTurnDisplay(turn);
        return;
      }
      if (event.type === 'turn-end') {
        const turn = pendingTurnRef.current;
        if (!turn || turn.turnId !== event.turnId) return;
        window.clearTimeout(turn.watchdog);
        turn.finished = true;
        turn.meta = event.meta ?? null;
        flushPacingWait(turn);
        if (turn.queue.length === 0) finishDisplayedTurn(turn);
        return;
      }
      if (event.type === 'turn-error') {
        abandonPendingTurn();
        cancelDesktopSpeech();
        setError(event.message);
        setLlmOnline(false);
        setSearching(false);
        setPhase('error');
        return;
      }
      if (event.type === 'turn-cancelled') {
        abandonPendingTurn();
        cancelDesktopSpeech();
        setSearching(false);
        setPhase(realtimeMicRef.current ? 'listening' : 'idle');
      }
    });
  }, [
    abandonPendingTurn,
    appendMessage,
    armTurnWatchdog,
    cancelDesktopSpeech,
    finishDisplayedTurn,
    flushPacingWait,
    realtimeClient,
    scheduleTurnDisplay,
    setLlmOnline,
    setPersonality
  ]);

  // Dual stream, action/voice side: playback receipts reported by the desktop.
  useEffect(
    () =>
      realtimeClient.on(ACTION_VOICE_TOPIC, (payload) => {
        const event = parseVoiceStreamEvent(payload);
        if (!event) return;
        if (event.type === 'speech-playback-started' && event.id === activeDesktopSpeechIdRef.current) {
          const timing = speechTimingRef.current;
          if (timing?.id === event.id) {
            setSpeechPlaybackStartMs(Math.max(0, nowMs() - timing.startedAt));
            speechTimingRef.current = null;
          }
          setDesktopTtsSpeaking(true);
          return;
        }
        if (event.type === 'speech-playback-completed' && event.id === activeDesktopSpeechIdRef.current) {
          clearDesktopSpeechSafetyTimer();
          activeDesktopSpeechIdRef.current = null;
          setDesktopTtsSpeaking(false);
          engine.interaction.onSpeechEnd();
        }
      }),
    [clearDesktopSpeechSafetyTimer, engine, realtimeClient]
  );

  useEffect(() => {
    let disposed = false;
    void loadWebSearchEnabled(false).then((enabled) => {
      if (!disposed) setWebSearchEnabledState(enabled);
    });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    phaseRef.current = phase;
    if (phase === 'listening') engine.interaction.onListeningStart();
    else if (phase === 'thinking' || phase === 'transcribing') engine.interaction.onListeningEnd();
    else if (phase === 'error') engine.interaction.onError();
  }, [engine, phase]);

  useEffect(() => {
    const statuses: CharacterActivityStatus[] = [];
    if (phase === 'initializing' || phase === 'listening') statuses.push('listening');
    if (phase === 'thinking' || phase === 'transcribing') statuses.push('thinking');
    if (phase === 'typing') statuses.push('typing');
    if (searching) statuses.push('searching');
    engine.interaction.replaceActivityStatuses(statuses);
    publishDesktopRealtimeSync({ type: 'character-status', statuses }, realtimeClient);
  }, [engine, phase, realtimeClient, searching]);

  useEffect(() => {
    let disposed = false;
    void speechRecognition.preload().then(
      () => {
        if (!disposed) setAsrReady(true);
      },
      (cause: unknown) => {
        if (!disposed)
          setError(
            cause instanceof Error ? `本地语音模型加载失败：${cause.message}` : '本地语音模型加载失败。'
          );
      }
    );
    return () => {
      disposed = true;
    };
  }, [speechRecognition]);

  useEffect(
    () => () => {
      interactionRunRef.current += 1;
      realtimeMicRef.current = false;
      if (realtimeRestartTimerRef.current !== null) window.clearTimeout(realtimeRestartTimerRef.current);
      if (historyEndNoticeTimerRef.current !== null) window.clearTimeout(historyEndNoticeTimerRef.current);
      const pending = pendingTurnRef.current;
      if (pending) {
        window.clearTimeout(pending.watchdog);
        if (pending.displayTimer !== null) window.clearTimeout(pending.displayTimer);
      }
      speechRecognition.destroy();
    },
    [speechRecognition]
  );

  useEffect(() => {
    setPhase('idle');
    setRealtimeMicEnabled(false);
    return () => {
      interactionRunRef.current += 1;
      realtimeMicRef.current = false;
      speechRecognition.abort();
    };
  }, [llm, speechRecognition]);

  const setWebSearchEnabled = (enabled: boolean) => {
    setWebSearchEnabledState(enabled);
    setError('');
    void saveWebSearchEnabled(enabled)
      .then(setWebSearchEnabledState)
      .catch((cause: unknown) => {
        setWebSearchEnabledState(!enabled);
        setError(cause instanceof Error ? cause.message : '联网搜索设置保存失败。');
      });
  };

  const sendText = async (text: string, source: MessageSource = 'text') => {
    const trimmed = text.trim();
    if (!trimmed || phaseRef.current === 'thinking' || phaseRef.current === 'typing') return;
    if (!characterSkill) {
      setError('角色卡仍在加载，暂时无法发起对话。');
      return;
    }

    const runId = interactionRunRef.current + 1;
    interactionRunRef.current = runId;
    const userMessage =
      source === 'system'
        ? { ...createMessage('user', trimmed), kind: 'system' as const }
        : createMessage('user', trimmed);
    const nextPersonality = source === 'system' ? personality : applyUserInteraction(personality, trimmed);
    setPersonality(nextPersonality);
    setError('');
    setPhase('thinking');
    interruptActiveTurn();

    const llmStartedAt = nowMs();
    if (source === 'voice') {
      setLlmFirstSpeechMs(null);
      setSpeechPlaybackStartMs(null);
      setLastVoiceTimings((current) => (current ? { ...current, llmResponseMs: null } : current));
    }

    try {
      const { turnId } = await submitChatTurn({
        message: userMessage,
        llmConfig: activeLlmConfig,
        personality: characterSkill.config,
        personalityState: nextPersonality,
        soulContext: engine.soul.getPromptContext(),
        webSearchEnabled,
        contextMessageLimit,
        ...(source === 'system' ? { internal: 'missed-reminder' as const } : {}),
        ttsLanguage,
        ttsEmotionMarkup
      });
      if (interactionRunRef.current !== runId) {
        // Interrupted while submitting; stop the turn that just started.
        cancelChatTurn(realtimeClient, turnId);
        return;
      }
      speechTimingRef.current = { id: turnId, startedAt: llmStartedAt };
      const turn: PendingTurn = {
        turnId,
        userText: trimmed,
        source,
        startedAt: llmStartedAt,
        delivered: [],
        queue: [],
        displayTimer: null,
        voiceStarted: false,
        running: false,
        finished: false,
        meta: null,
        lastPresentation: null,
        watchdog: 0
      };
      pendingTurnRef.current = turn;
      armTurnWatchdog(
        turn,
        activeLlmConfig.provider === 'ollama' ? OLLAMA_TURN_TIMEOUT_MS : LLM_TURN_TIMEOUT_MS
      );
    } catch (cause) {
      if (interactionRunRef.current !== runId) return;
      setError(cause instanceof Error ? cause.message : '聊天服务请求失败');
      setLlmOnline(false);
      setPhase('error');
    }
  };

  sendTextRef.current = sendText;

  useEffect(() => {
    if (!characterSkill) return;
    const drain = () => {
      for (const event of takeMissedReminders()) {
        const messageId = `reminder-${event.jobId}-${event.dueAt}`;
        if (seenRealtimeMessageIdsRef.current.has(messageId)) continue;
        seenRealtimeMessageIdsRef.current.add(messageId);
        void sendTextRef.current(
          `系统事件：用户错过了“${event.message}”这一既定事项。请以当前角色口吻主动关心并询问用户，不要提及系统或任务。`,
          'system'
        );
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === MISSED_REMINDER_STORAGE_KEY) drain();
    };
    drain();
    window.addEventListener('storage', onStorage);
    window.addEventListener(MISSED_REMINDERS_CHANGED_EVENT, drain);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(MISSED_REMINDERS_CHANGED_EVENT, drain);
    };
  }, [characterSkill]);

  const clearVoiceTimers = () => {
    if (realtimeRestartTimerRef.current !== null) window.clearTimeout(realtimeRestartTimerRef.current);
    realtimeRestartTimerRef.current = null;
  };

  const commitRealtimeTranscript = async () => {
    const transcript = voiceTranscriptRef.current.trim();
    if (!transcript) {
      setPhase('listening');
      return;
    }
    voiceTranscriptRef.current = '';
    setPhase('transcribing');
    await sendTextRef.current(transcript, 'voice');
  };

  const beginRealtimeSession = () => {
    if (!realtimeMicRef.current) return;
    voiceTranscriptRef.current = '';
    setPhase(speechRecognition.isReady() ? 'listening' : 'initializing');
    speechRecognition.startContinuous({
      mode: 'realtime',
      onTranscript: (text, isFinal) => {
        if (!isFinal) return;
        voiceTranscriptRef.current = text;
        setInput(text);
        void commitRealtimeTranscript();
      },
      onError: (cause) => {
        realtimeMicRef.current = false;
        setRealtimeMicEnabled(false);
        clearVoiceTimers();
        speechRecognition.abort();
        setError(cause.message);
        setPhase('error');
      },
      onStarted: () => setPhase('listening'),
      onEnd: () => {
        if (!realtimeMicRef.current && phaseRef.current !== 'thinking') setPhase('idle');
      },
      onTimings: (timings) => setLastVoiceTimings({ ...timings, llmResponseMs: null }),
      onSpeechStart: () => {
        if (!realtimeMicRef.current) return;
        interruptActiveTurn();
        if (phaseRef.current === 'thinking' || phaseRef.current === 'typing') {
          interactionRunRef.current += 1;
          setError('');
        }
        voiceTranscriptRef.current = '';
        setInput('');
        setPhase('listening');
      }
    });
  };

  const enableRealtimeMic = () => {
    if (!speechRecognition.isSupported() || realtimeMicRef.current) return;
    realtimeMicRef.current = true;
    setRealtimeMicEnabled(true);
    setError('');
    beginRealtimeSession();
  };

  const disableRealtimeMic = () => {
    realtimeMicRef.current = false;
    setRealtimeMicEnabled(false);
    clearVoiceTimers();
    if (speechRecognition.finishCurrentUtterance()) {
      setPhase('transcribing');
      return;
    }
    speechRecognition.abort();
    setPhase((current) => (current === 'thinking' || current === 'typing' ? current : 'idle'));
  };

  useEffect(() => {
    if (voiceSettings.inputMode === 'realtime') enableRealtimeMic();
    else if (realtimeMicRef.current) disableRealtimeMic();
  }, [voiceSettings.inputMode]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = input;
    if (realtimeMicRef.current) {
      speechRecognition.abort();
      clearVoiceTimers();
      voiceTranscriptRef.current = '';
      void sendText(text).finally(() => {
        if (realtimeMicRef.current) beginRealtimeSession();
      });
      return;
    }
    void sendText(text);
  };

  const startListening = async () => {
    disableRealtimeMic();
    const runId = interactionRunRef.current + 1;
    interactionRunRef.current = runId;
    setError('');
    setPhase(speechRecognition.isReady() ? 'listening' : 'initializing');
    try {
      const transcript = await speechRecognition.listen(
        undefined,
        () => setPhase('listening'),
        (timings) => setLastVoiceTimings({ ...timings, llmResponseMs: null })
      );
      if (interactionRunRef.current !== runId) return;
      setInput(transcript);
      if (!transcript.trim()) {
        setPhase('idle');
        return;
      }
      await sendText(transcript, 'voice');
    } catch (cause) {
      if (interactionRunRef.current !== runId) return;
      speechRecognition.abort();
      setError(cause instanceof Error ? cause.message : 'Speech recognition failed');
      setPhase('error');
    }
  };

  const cancel = () => {
    interactionRunRef.current += 1;
    realtimeMicRef.current = false;
    setRealtimeMicEnabled(false);
    clearVoiceTimers();
    interruptActiveTurn();
    speechRecognition.abort();
    setSearching(false);
    setPhase('idle');
  };

  const interruptReply = () => {
    interactionRunRef.current += 1;
    interruptActiveTurn();
    setSearching(false);
    setError('');
    setPhase(realtimeMicRef.current ? 'listening' : 'idle');
  };

  usePushToTalk(
    speechRecognition,
    startListening,
    setPhase,
    interruptReply,
    voiceSettings.inputMode === 'push-to-talk' && asrReady,
    voiceSettings.pushToTalkCode
  );

  const clearMessages = () => {
    cancel();
    messagesRef.current = [];
    setMessages([]);
    seenRealtimeMessageIdsRef.current.clear();
    setHasOlderMessages(false);
    setError('');
    void clearChatHistory().catch((cause) =>
      setError(cause instanceof Error ? cause.message : '清空记录失败')
    );
  };

  // Loading wins: a request in flight is the more useful thing to say.
  const historyNotice: ChatHistoryNotice | null = historyLoading
    ? { key: 'loading', text: '正在加载记录…', terminal: false }
    : historyEndNoticeVisible
    ? { key: `end-${historyEndNoticeId}`, text: '没有更多了', terminal: true }
    : null;

  return {
    activeLlmConfig,
    updateLlmConfig,
    speechRecognition,
    messages,
    personality,
    currentNeed,
    setPersonality,
    characterSkill,
    characterSkillError,
    input,
    setInput,
    phase,
    setPhase,
    error,
    models,
    llmOnline,
    realtimeState,
    webSearchEnabled,
    setWebSearchEnabled,
    canInterruptReply: phase === 'thinking' || phase === 'typing' || desktopTtsSpeaking,
    realtimeMicEnabled,
    voiceMode: voiceSettings.inputMode,
    pushToTalkLabel: formatShortcut(voiceSettings.pushToTalkCode),
    historyLoading,
    hasOlderMessages,
    historyNotice,
    revealHistoryEnd,
    asrReady,
    loadOlderMessages,
    lastVoiceTimings,
    llmFirstSpeechMs,
    speechPlaybackStartMs,
    skillMessage,
    skillInputRef,
    enableRealtimeMic,
    disableRealtimeMic,
    submit,
    startListening,
    cancel,
    interruptReply,
    resetPersonality,
    importCharacterCard,
    clearMessages
  };
}

function createToolResultChatMessage(event: ToolResultEvent): ChatMessage {
  const detail = event.success
    ? formatSchedulerToolResult(event.speech, event.content)
    : `${event.speech}${event.error ? `\n${event.error}` : ''}`;
  return createMessage('assistant', detail);
}

function formatSchedulerToolResult(speech: string, content: unknown): string {
  const tasks = (Array.isArray(content) ? content : content ? [content] : []).filter(isSchedulerTask);
  if (tasks.length === 0) return speech;
  return [
    speech,
    ...tasks.map((task, index) =>
      [
        `${Array.isArray(content) ? `${index + 1}. ` : ''}${task.name}`,
        `时间：${new Date(task.nextRunAt).toLocaleString('zh-CN', { hour12: false })}`,
        `内容：${task.event.text}`,
        `ID：${task.id}`
      ].join('\n')
    )
  ].join('\n\n');
}

function isSchedulerTask(value: unknown): value is SchedulerTask {
  if (!value || typeof value !== 'object') return false;
  const task = value as Partial<SchedulerTask>;
  return (
    typeof task.id === 'string' &&
    typeof task.name === 'string' &&
    typeof task.nextRunAt === 'number' &&
    Boolean(task.event)
  );
}

function recordLlmSoulEvent(
  soul: SoulManager,
  eventType: import('../../soul').SoulEventType,
  text: string
): void {
  const labels = { praise: '夸奖', chat: '聊天', belittle: '贬低' } as const;
  soul.record(eventType, `LLM 判断为${labels[eventType]}：${text.slice(0, 80)}`);
}
