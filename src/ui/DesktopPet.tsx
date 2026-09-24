import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isTauriDesktop,
  openChatWindow,
  openPetContextMenu,
  startDesktopWindowDrag
} from '../desktop/tauri/navigation';
import { useDesktopWindow } from '../desktop/tauri/useDesktopWindow';
import { useDesktopCharacter } from '../desktop/tauri/useDesktopCharacter';
import type { ModelHitTest } from '../character/vrm/modelHitTest';
import { VrmStage } from '../character/vrm/VrmStage';
import './desktop-pet.css';

import type { CharacterController } from '../character/CharacterController';
import {
  listenDesktopRealtimeSync,
  publishDesktopRealtimeSync
} from '../app/network/realtime/DesktopRealtimeSync';
import { listenVoiceBroadcast, publishVoiceBroadcast } from '../ai/tts/voiceBroadcast';
import { DesktopReminderQueue } from '../desktop/tauri/DesktopReminderQueue';
import { DesktopConversationSpeechStream } from '../desktop/tauri/DesktopConversationSpeechStream';
import { useDesktopTtsProvider } from '../desktop/tauri/useDesktopTtsProvider';
import {
  createDefaultReminderJobStore,
  DesktopReminderScheduler
} from '../desktop/tauri/DesktopReminderScheduler';
import type { ToolResultEvent } from '../scheduler/SchedulerTypes';
import { toToolResultSpeechEvent } from '../desktop/tauri/DesktopToolResultBridge';
import type { CharacterActivityStatus } from '../character/interaction/CharacterInteractionController';
import { saveMissedReminder } from '../desktop/tauri/MissedReminderInbox';
import { applyMoodPresentation } from '../character/expression/moodPresentation';
import { useUiPreferences } from '../app/settings/useUiPreferences';
import { resolveInteractionHints } from '../app/settings/interactionHints';

const ignoreStatus = () => undefined;
const dragModel = () => {
  void startDesktopWindowDrag();
};
const activityStatusLabels: Record<CharacterActivityStatus, string> = {
  listening: '倾听中',
  thinking: '思考中',
  typing: '输入中',
  searching: '查询中'
};

export function DesktopPet() {
  const root = useRef<HTMLElement>(null);
  const hitTest = useRef<ModelHitTest | null>(null);
  const { settings, modelUrl } = useDesktopCharacter();
  const ttsProvider = useDesktopTtsProvider();
  // Owned by the settings window; `useUiPreferences` picks the change up through
  // the cross-window `storage` event.
  const hints = resolveInteractionHints(useUiPreferences().interactionHints);
  const [engine, setEngine] = useState<CharacterController | null>(null);
  const engineRef = useRef<CharacterController | null>(null);
  const [activityStatuses, setActivityStatuses] = useState<CharacterActivityStatus[]>([]);
  const activityStatusesRef = useRef<CharacterActivityStatus[]>([]);
  const [toolResult, setToolResult] = useState<ToolResultEvent | null>(null);
  const reminderQueueRef = useRef<DesktopReminderQueue | null>(null);
  const conversationSpeechRef = useRef<DesktopConversationSpeechStream | null>(null);
  const handleHitTest = useCallback((test: ModelHitTest | null) => {
    hitTest.current = test;
  }, []);
  useDesktopWindow(root, hitTest);

  useEffect(() => {
    engineRef.current = engine;
    if (!engine) return;
    engine.interaction.replaceActivityStatuses(activityStatusesRef.current);
    return engine.interaction.subscribeActivityStatuses(setActivityStatuses);
  }, [engine]);

  useEffect(() => {
    reminderQueueRef.current?.setProcessor(
      engine
        ? async (event) => {
            const speech = (event.speech ?? event.message).trim();
            const speechId = `reminder-${event.jobId}`;
            if (speech)
              publishVoiceBroadcast({
                type: 'speech-start',
                id: speechId,
                text: speech,
                source: 'reminder'
              });
            try {
              await engine.actions.enqueueReminder(event.jobId, event);
            } finally {
              if (speech)
                publishVoiceBroadcast({
                  type: 'speech-end',
                  id: speechId,
                  text: speech,
                  source: 'reminder'
                });
            }
          }
        : undefined
    );
  }, [engine]);

  useEffect(() => {
    const stream = engine
      ? new DesktopConversationSpeechStream(
          engine.speech,
          (type, id) => {
            publishVoiceBroadcast({ type, id, source: 'conversation' });
          },
          engine.replyShortActions,
          (emotion, intensity) => {
            applyMoodPresentation(engine, emotion, intensity);
          }
        )
      : null;
    conversationSpeechRef.current?.dispose();
    conversationSpeechRef.current = stream;
    return () => stream?.dispose();
  }, [engine]);

  useEffect(() => {
    const reminderQueue = new DesktopReminderQueue((type, jobId) => {
      publishDesktopRealtimeSync({ type, jobId });
    });
    const reminderScheduler = new DesktopReminderScheduler(
      createDefaultReminderJobStore(),
      (event) => {
        if (event.missed) {
          saveMissedReminder(event);
          void openChatWindow();
        } else {
          reminderQueue.handle(event);
        }
        publishDesktopRealtimeSync(event);
      },
      Date.now,
      (cause) => console.error('[DesktopReminderScheduler]', cause),
      (event) => publishDesktopRealtimeSync(event)
    );
    reminderQueueRef.current = reminderQueue;
    const unsubscribeSync = listenDesktopRealtimeSync((event) => {
      void reminderScheduler
        .handle(event)
        .catch((cause) => console.error('[DesktopReminderScheduler]', cause));
      if (!(event.type === 'reminder' && event.missed)) reminderQueue.handle(event);
      if (event.type === 'character-status') {
        activityStatusesRef.current = event.statuses;
        setActivityStatuses(event.statuses);
        engineRef.current?.interaction.replaceActivityStatuses(event.statuses);
      }
      if (event.type === 'tool-result') {
        if (event.tool !== 'web-search' || !event.success) setToolResult(event);
        const speechEvent = toToolResultSpeechEvent(event);
        if (speechEvent) reminderQueue.handle(speechEvent);
      }
    });
    const unsubscribeVoice = listenVoiceBroadcast((event) => {
      reminderQueue.handleVoiceEvent(event);
      conversationSpeechRef.current?.handle(event);
    });
    void reminderScheduler.start().catch((cause) => console.error('[DesktopReminderScheduler]', cause));
    return () => {
      unsubscribeSync();
      unsubscribeVoice();
      reminderScheduler.dispose();
      if (reminderQueueRef.current === reminderQueue) reminderQueueRef.current = null;
      conversationSpeechRef.current?.dispose();
      conversationSpeechRef.current = null;
      reminderQueue.dispose();
    };
  }, []);

  return (
    <main
      ref={root}
      className="desktop-pet"
      aria-label="Shiro 桌面伙伴"
      onContextMenu={(event) => {
        event.preventDefault();
        if (
          !root.current?.hasAttribute('data-interactive') &&
          !hitTest.current?.(event.clientX, event.clientY)
        )
          return;
        void openPetContextMenu({ x: event.screenX, y: event.screenY });
      }}
    >
      <VrmStage
        modelUrl={modelUrl}
        avatarFitConfig={settings.avatarFit}
        holdMicroMotionEnabled={settings.holdMicroMotionEnabled}
        footIkEnabled={settings.footIkEnabled}
        speechBubbleEnabled={hints.speechBubble}
        ttsProvider={ttsProvider}
        renderConfig={settings.renderConfig}
        proportionConfig={settings.proportionConfig}
        onEngineReady={setEngine}
        onStatus={ignoreStatus}
        onHitTestReady={handleHitTest}
        onModelDrag={isTauriDesktop() ? dragModel : undefined}
      />
      {hints.characterStatus && activityStatuses.length ? (
        <output className="desktop-character-status" aria-live="polite">
          {activityStatuses.map((status) => (
            <span key={status}>{activityStatusLabels[status]}</span>
          ))}
        </output>
      ) : null}
      {hints.toolResult && toolResult ? (
        <aside className="desktop-tool-result" data-success={toolResult.success}>
          <strong>{toolResult.tool === 'scheduler' ? '定时工具' : '联网查询'}</strong>
          <span>{toolResult.speech}</span>
          {toolResult.error ? <small>{toolResult.error}</small> : null}
          {toolResult.content !== undefined ? <pre>{JSON.stringify(toolResult.content, null, 2)}</pre> : null}
          <button type="button" onClick={() => setToolResult(null)} aria-label="关闭工具结果">
            ×
          </button>
        </aside>
      ) : null}
    </main>
  );
}
