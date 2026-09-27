import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode
} from 'react';
import { isTauriDesktop, openChatWindow, openPetContextMenu } from '../desktop/tauri/navigation';
import { useDesktopWindow } from '../desktop/tauri/useDesktopWindow';
import { useDesktopCharacter } from '../desktop/tauri/useDesktopCharacter';
import { castSlot, FULL_STAGE, screenStageArea } from '../desktop/tauri/desktopCastLayout';
import type { ModelHitTest } from '../character/vrm/modelHitTest';
import { VrmStage } from '../character/vrm/VrmStage';
import { SharedStageRenderer } from '../character/vrm/SharedStageRenderer';
import { DEFAULT_CAMERA_ZOOM } from '../character/vrm/cameraZoom';
import { CharacterEntryCircle, useCharacterEntryEffect } from '../character/vrm/CharacterEntryEffect';
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
import { loadPetCameraZoom, savePetCameraZoom } from '../desktop/tauri/petCameraZoom';
import {
  CHARACTER_PROFILES_KEY,
  loadCharacterProfiles,
  makeCharacterProfile,
  type CharacterProfile
} from '../character/characterProfiles';
import {
  loadMeetingDesktopCast,
  loadMeetings,
  MEETING_DESKTOP_CAST_KEY,
  MEETINGS_KEY
} from './meeting/meetingState';
import { listImportedVrms } from '../character/vrm/ImportedVrmStore';
import { resolveVrmModelOption } from '../character/vrm/assets/vrmModels';
import type { VoiceStreamEvent } from '../app/network/realtime/VoiceStreamProtocol';

const ignoreStatus = () => undefined;
const dragModel = () => window.dispatchEvent(new Event('servant-model-drag'));
const MEETING_STAGE_KEY = 'servant.meetingStage.v1';
type StagePose = { x: number; y: number; zoom: number; z: number };
type StageLayout = Record<string, StagePose>;
function loadStageLayout(): StageLayout {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(MEETING_STAGE_KEY) ?? '{}');
    return value && typeof value === 'object' ? value as StageLayout : {};
  } catch { return {}; }
}
const activityStatusLabels: Record<CharacterActivityStatus, string> = {
  listening: '倾听中',
  thinking: '思考中',
  typing: '输入中',
  searching: '查询中'
};

export function DesktopPet() {
  const root = useRef<HTMLElement>(null);
  const sharedCanvas = useRef<HTMLCanvasElement>(null);
  const [sharedStageRenderer, setSharedStageRenderer] = useState<SharedStageRenderer | null>(null);
  const [sharedRendererFailed, setSharedRendererFailed] = useState(false);
  useEffect(() => {
    const canvas = sharedCanvas.current;
    if (!canvas) return;
    try {
      const renderer = new SharedStageRenderer(canvas);
      setSharedStageRenderer(renderer);
      return () => { renderer.dispose(); setSharedStageRenderer(null); };
    } catch (error) {
      console.error('Unable to initialize the shared desktop stage renderer', error);
      setSharedRendererFailed(true);
    }
  }, []);
  const actorHitTests = useRef(new Map<string, ModelHitTest>());
  const hitTest = useRef<ModelHitTest | null>((x, y) => {
    const ids = [...document.elementsFromPoint(x, y)]
      .map((element) => element.closest<HTMLElement>('.desktop-cast-actor')?.dataset.characterId)
      .filter((id): id is string => Boolean(id));
    for (const id of new Set(ids)) {
      const test = actorHitTests.current.get(id);
      if (!test) continue;
      const part = test(x, y);
      if (part) return part;
    }
    return null;
  });
  const { settings, modelUrl } = useDesktopCharacter();
  const cast = useDesktopCast(modelUrl);
  const castModeRef = useRef(false);
  const [stageArea, setStageArea] = useState<typeof FULL_STAGE | null>(null);
  useEffect(() => {
    const enabled = cast.length > 1;
    if (castModeRef.current === enabled) {
      if (!enabled) localStorage.removeItem('servant.desktopStageMode');
      return;
    }
    castModeRef.current = enabled;
    setStageLayout({});
    if (!isTauriDesktop()) { setStageArea(FULL_STAGE); return; }
    setStageArea(null);
    localStorage.setItem('servant.desktopStageMode', String(enabled));
    void (async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      let area = FULL_STAGE;
      if (enabled) {
        const { currentMonitor, primaryMonitor, availableMonitors } = await import('@tauri-apps/api/window');
        const [current, monitors] = await Promise.all([currentMonitor(), availableMonitors()]);
        const monitor = current ?? await primaryMonitor() ?? monitors[0];
        if (monitor) {
          const work = monitor.workArea;
          area = screenStageArea(
            { x: work.position.x, y: work.position.y, ...work.size },
            monitors.map(({ position, size }) => ({ x: position.x, y: position.y, ...size }))
          );
        }
      }
      await invoke('set_desktop_stage_mode', { enabled });
      setStageArea(area);
    })().catch((error) => {
      console.error('Unable to resize desktop stage for all monitors', error);
      setStageArea(FULL_STAGE);
    }).finally(() => {
      if (!enabled) localStorage.removeItem('servant.desktopStageMode');
    });
  }, [cast.length]);
  const [stageLayout, setStageLayout] = useState<StageLayout>(loadStageLayout);
  useEffect(() => localStorage.setItem(MEETING_STAGE_KEY, JSON.stringify(stageLayout)), [stageLayout]);
  const castActive = cast.length > 1;
  const area = stageArea ?? FULL_STAGE;
  const mainIndex = cast.findIndex(({ profile }) => profile.isMain);
  const defaultPose = (index: number): StagePose => ({
    x: area.x + castSlot(index, cast.length, mainIndex) * area.width / cast.length,
    y: area.y,
    zoom: DEFAULT_CAMERA_ZOOM,
    z: index + 1
  });
  const updatePose = (id: string, update: Partial<StagePose>, index: number) =>
    setStageLayout((current) => ({ ...current, [id]: { ...defaultPose(index), ...current[id], ...update } }));
  const mainCharacterId =
    loadCharacterProfiles().find((profile) => profile.isMain)?.id ?? cast[0]?.profile.id ?? 'main';
  const mainCharacterIdRef = useRef(mainCharacterId);
  mainCharacterIdRef.current = mainCharacterId;
  // Owned by the settings window; `useUiPreferences` picks the change up through
  // the cross-window `storage` event.
  const hints = resolveInteractionHints(useUiPreferences().interactionHints);
  // The stage only reads this when it builds (or rebuilds) its camera, so a
  // wheel tick costs a re-render but never restarts the running model.
  const [petZoom, setPetZoom] = useState(loadPetCameraZoom);
  const handleZoomChange = useCallback((zoom: number) => {
    setPetZoom(zoom);
    savePetCameraZoom(zoom);
  }, []);
  const [engine, setEngine] = useState<CharacterController | null>(null);
  const engineRef = useRef<CharacterController | null>(null);
  const actorEnginesRef = useRef(new Map<string, CharacterController>());
  const actorSpeechRef = useRef(new Map<string, DesktopConversationSpeechStream>());
  const pendingVoiceRef = useRef(new Map<string, VoiceStreamEvent[]>());
  const [activityStatuses, setActivityStatuses] = useState<CharacterActivityStatus[]>([]);
  const activityStatusesRef = useRef<CharacterActivityStatus[]>([]);
  const [toolResult, setToolResult] = useState<ToolResultEvent | null>(null);
  const reminderQueueRef = useRef<DesktopReminderQueue | null>(null);
  const recoverStage = useCallback(() => {
    // Native recovery collapses the all-monitor stage onto one visible screen.
    castModeRef.current = false;
    setStageArea(FULL_STAGE);
    setStageLayout({});
  }, []);
  useDesktopWindow(root, hitTest, recoverStage);

  const registerHitTest = useCallback((characterId: string, test: ModelHitTest | null) => {
    if (test) actorHitTests.current.set(characterId, test);
    else actorHitTests.current.delete(characterId);
  }, []);

  const registerEngine = useCallback((characterId: string, next: CharacterController | null) => {
    actorSpeechRef.current.get(characterId)?.dispose();
    actorSpeechRef.current.delete(characterId);
    if (!next) {
      actorEnginesRef.current.delete(characterId);
      if (characterId === mainCharacterIdRef.current) setEngine(null);
      return;
    }
    actorEnginesRef.current.set(characterId, next);
    const stream = new DesktopConversationSpeechStream(
      next.speech,
      (type, id) =>
        publishVoiceBroadcast({
          type,
          id,
          characterId,
          source: 'conversation'
        }),
      next.replyShortActions,
      (emotion, intensity, expression) => {
        applyMoodPresentation(next, emotion, intensity);
        if (expression) void next.expression.set(expression, 1, 900);
      }
    );
    actorSpeechRef.current.set(characterId, stream);
    pendingVoiceRef.current.get(characterId)?.forEach((event) => stream.handle(event));
    pendingVoiceRef.current.delete(characterId);
    if (characterId === mainCharacterIdRef.current) setEngine(next);
  }, []);

  useEffect(() => {
    setEngine(actorEnginesRef.current.get(mainCharacterId) ?? null);
  }, [mainCharacterId]);

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
      const characterId = event.characterId ?? mainCharacterIdRef.current;
      const stream = actorSpeechRef.current.get(characterId);
      if (stream) stream.handle(event);
      else {
        const pending = pendingVoiceRef.current.get(characterId) ?? [];
        pending.push(event);
        pendingVoiceRef.current.set(characterId, pending.slice(-32));
      }
    });
    void reminderScheduler.start().catch((cause) => console.error('[DesktopReminderScheduler]', cause));
    return () => {
      unsubscribeSync();
      unsubscribeVoice();
      reminderScheduler.dispose();
      if (reminderQueueRef.current === reminderQueue) reminderQueueRef.current = null;
      actorSpeechRef.current.forEach((stream) => stream.dispose());
      actorSpeechRef.current.clear();
      pendingVoiceRef.current.clear();
      reminderQueue.dispose();
    };
  }, []);

  return (
    <main
      ref={root}
      className="desktop-pet"
      data-shared-stage={Boolean(sharedStageRenderer)}
      aria-label="Servant 桌面伙伴"
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
      <canvas ref={sharedCanvas} className="desktop-stage-canvas" aria-hidden="true" />
      <div
        className="desktop-cast"
        data-free={castActive}
        data-count={cast.length}
        style={{ '--desktop-cast-count': Math.max(1, cast.length) } as CSSProperties}
      >
        {cast.map(({ profile, modelUrl: actorModelUrl }, index) => {
          if (!sharedStageRenderer && !sharedRendererFailed) return null;
          if (castActive && isTauriDesktop() && !stageArea) return null;
          const pose = { ...defaultPose(index), ...stageLayout[profile.id] };
          return (
          <DesktopActorBoundary key={profile.id}>
            <div className="desktop-cast-actor" data-character-id={profile.id} data-free={castActive} data-layer={pose.z} style={castActive ? {
              left: `${pose.x}%`, bottom: `${pose.y}%`, zIndex: pose.z,
              width: `${area.width / cast.length}%`, height: `${area.height}%`
            } : undefined}
              onPointerDown={castActive ? (event) => {
                if (event.button !== 0 || !event.isPrimary) return;
                const rect = root.current?.getBoundingClientRect();
                if (!rect) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                const pointerId = event.pointerId;
                const startX = event.clientX, startY = event.clientY;
                const original = { x: pose.x, y: pose.y };
                let nextX = pose.x, nextY = pose.y;
                const actor = event.currentTarget;
                actor.dataset.dragging = 'true';
                updatePose(profile.id, { z: Math.max(0, ...Object.values(stageLayout).map((item) => item.z ?? 0)) + 1 }, index);
                const move = (moveEvent: PointerEvent) => {
                  if (moveEvent.pointerId !== pointerId) return;
                  if ((moveEvent.buttons & 1) === 0) { done(); return; }
                  nextX = Math.max(-20, Math.min(120, original.x + (moveEvent.clientX - startX) / rect.width * 100));
                  nextY = Math.max(-30, Math.min(70, original.y - (moveEvent.clientY - startY) / rect.height * 100));
                  actor.style.left = `${nextX}%`;
                  actor.style.bottom = `${nextY}%`;
                };
                const done = (endEvent?: PointerEvent | Event) => {
                  if (endEvent && 'pointerId' in endEvent && endEvent.pointerId !== pointerId) return;
                  window.removeEventListener('pointermove', move);
                  window.removeEventListener('pointerup', done, true);
                  window.removeEventListener('pointercancel', done, true);
                  window.removeEventListener('blur', done);
                  actor.removeEventListener('lostpointercapture', done);
                  if (actor.hasPointerCapture(pointerId)) actor.releasePointerCapture(pointerId);
                  delete actor.dataset.dragging;
                  updatePose(profile.id, { x: nextX, y: nextY }, index);
                };
                window.addEventListener('pointermove', move);
                window.addEventListener('pointerup', done, true);
                window.addEventListener('pointercancel', done, true);
                window.addEventListener('blur', done);
                actor.addEventListener('lostpointercapture', done);
              } : undefined}
              onDoubleClick={castActive ? () => updatePose(profile.id, { z: 0 }, index) : undefined}
            >
              <DesktopActor
              sharedStageRenderer={sharedStageRenderer}
              acceptsUntargetedSpeech={profile.id === mainCharacterId}
              modelUrl={actorModelUrl}
              profile={profile}
              settings={settings}
              speechBubbleEnabled={hints.speechBubble}
              initialZoom={castActive ? pose.zoom : profile.id === mainCharacterId ? petZoom : undefined}
              onZoomChange={castActive ? (zoom) => updatePose(profile.id, { zoom }, index) : profile.id === mainCharacterId ? handleZoomChange : undefined}
              wheelZoomEnabled={castActive || profile.id === mainCharacterId}
              allowWindowDrag={!castActive}
              onEngineChange={registerEngine}
              onHitTestChange={registerHitTest}
            />
            </div>
          </DesktopActorBoundary>
          );
        })}
      </div>
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

class DesktopActorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[DesktopPet] meeting actor failed to render', error, info.componentStack);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

interface DesktopActorProps {
  sharedStageRenderer: SharedStageRenderer | null;
  acceptsUntargetedSpeech: boolean;
  modelUrl: string;
  profile: CharacterProfile;
  settings: ReturnType<typeof useDesktopCharacter>['settings'];
  speechBubbleEnabled: boolean;
  initialZoom?: number;
  wheelZoomEnabled: boolean;
  allowWindowDrag: boolean;
  onZoomChange?(zoom: number): void;
  onEngineChange(characterId: string, engine: CharacterController | null): void;
  onHitTestChange(characterId: string, hitTest: ModelHitTest | null): void;
}

// ponytail: actors keep separate controllers and scenes; the shared stage owns rendering and frame budgets.
function DesktopActor({
  sharedStageRenderer,
  acceptsUntargetedSpeech,
  modelUrl,
  profile,
  settings,
  speechBubbleEnabled,
  initialZoom,
  wheelZoomEnabled,
  allowWindowDrag,
  onZoomChange,
  onEngineChange,
  onHitTestChange
}: DesktopActorProps) {
  const entry = useCharacterEntryEffect(acceptsUntargetedSpeech);
  const [entryBounds, setEntryBounds] = useState({ footY: 96, headY: 12 });
  const ttsProvider = useDesktopTtsProvider(profile.voiceId);
  const ready = useCallback(
    (engine: CharacterController) => {
      entry.play();
      onEngineChange(profile.id, engine);
    },
    [entry.play, onEngineChange, profile.id]
  );
  const hitTest = useCallback(
    (test: ModelHitTest | null) => onHitTestChange(profile.id, test),
    [onHitTestChange, profile.id]
  );
  const onCharacterProjection = useCallback(setEntryBounds, []);
  useEffect(
    () => () => {
      onEngineChange(profile.id, null);
      onHitTestChange(profile.id, null);
    },
    [onEngineChange, onHitTestChange, profile.id]
  );
  useEffect(() => entry.cancel(), [entry.cancel, modelUrl]);

  return (
    <section className="desktop-actor" aria-label={profile.name}>
      <VrmStage
        rotationEnabled={allowWindowDrag}
        sharedStageRenderer={sharedStageRenderer ?? undefined}
        characterId={profile.id}
        acceptsUntargetedSpeech={acceptsUntargetedSpeech}
        modelUrl={modelUrl}
        avatarFitConfig={settings.avatarFit}
        holdMicroMotionEnabled={settings.holdMicroMotionEnabled}
        footIkEnabled={settings.footIkEnabled}
        speechBubbleEnabled={speechBubbleEnabled}
        ttsProvider={ttsProvider}
        renderConfig={settings.renderConfig}
        proportionConfig={settings.proportionConfig}
        initialZoom={initialZoom}
        wheelZoomEnabled={wheelZoomEnabled}
        wheelZoomAnchorY={0}
        viewCenterOffsetY={settings.proportionConfig.chibiEnabled ? -0.1 : 0}
        dissolveProgress={entry.progress}
        onCharacterProjection={onCharacterProjection}
        onZoomChange={onZoomChange}
        onEngineReady={ready}
        onStatus={ignoreStatus}
        onHitTestReady={hitTest}
        onModelDrag={allowWindowDrag && isTauriDesktop() ? dragModel : undefined}
      />
      <CharacterEntryCircle active={entry.active} startY={entryBounds.footY} endY={entryBounds.headY} />
    </section>
  );
}

function useDesktopCast(mainModelUrl: string): Array<{ profile: CharacterProfile; modelUrl: string }> {
  const [revision, setRevision] = useState(0);
  const [importedUrls, setImportedUrls] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const refresh = (event?: StorageEvent) => {
      if (
        !event ||
        event.key === CHARACTER_PROFILES_KEY ||
        event.key === MEETINGS_KEY ||
        event.key === MEETING_DESKTOP_CAST_KEY
      )
        setRevision((value) => value + 1);
    };
    const refreshStorage = (event: StorageEvent) => refresh(event);
    const refreshProfiles = () => refresh();
    const refreshCast = () => refresh();
    window.addEventListener('storage', refreshStorage);
    window.addEventListener('servant:character-profiles-changed', refreshProfiles);
    window.addEventListener('servant:meeting-desktop-cast-changed', refreshCast);
    return () => {
      window.removeEventListener('storage', refreshStorage);
      window.removeEventListener('servant:character-profiles-changed', refreshProfiles);
      window.removeEventListener('servant:meeting-desktop-cast-changed', refreshCast);
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    const urls: string[] = [];
    void listImportedVrms()
      .then((records) => {
        if (disposed) return;
        const next = new Map(
          records.map((record) => {
            const url = URL.createObjectURL(record.blob);
            urls.push(url);
            return [record.id, url] as const;
          })
        );
        setImportedUrls(next);
      })
      .catch((error) => console.error('Unable to load meeting VRM models', error));
    return () => {
      disposed = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  return useMemo(() => {
    const profiles = loadCharacterProfiles();
    const main =
      profiles.find((profile) => profile.isMain) ??
      profiles[0] ??
      makeCharacterProfile({ id: 'main', isMain: true });
    try {
      const castSession = loadMeetingDesktopCast();
      const meeting = castSession
        ? loadMeetings().find((session) => session.id === castSession && session.status !== 'ended')
        : undefined;
      const selected = meeting
        ? meeting.participants
            .map((id) => profiles.find((profile) => profile.id === id))
            .filter((profile): profile is CharacterProfile => Boolean(profile))
        : [main];
      const roster = selected.length ? selected : [main];
      return roster.map((profile) => ({
        profile,
        modelUrl:
          profile.id === main.id
            ? mainModelUrl
            : importedUrls.get(profile.vrmId) ?? resolveVrmModelOption(profile.vrmId).url
      }));
    } catch (error) {
      console.error('[DesktopPet] invalid meeting cast, falling back to main character', error);
      return [{ profile: main, modelUrl: mainModelUrl }];
    }
  }, [importedUrls, mainModelUrl, revision]);
}
