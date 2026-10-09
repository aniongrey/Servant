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
import { fixStageWindowFrame } from '../desktop/tauri/stageWindow';
import { useDesktopWindow } from '../desktop/tauri/useDesktopWindow';
import { useDesktopCharacter } from '../desktop/tauri/useDesktopCharacter';
import { autoCastCenterX, castColumnLeft, FULL_STAGE } from '../desktop/tauri/desktopCastLayout';
import { StageControls, type StageActivity, type StageLightingPreview } from './stage/StageControls';
import { listenStageReplying } from './stage/stageReplyingChannel';
import { stageSegmentFromPlayback, type StageSegment } from './stage/stageSegment';
import { useStageMeeting } from './stage/useStageMeeting';
import { actorLighting, backgroundSource, bounded, loadStageScene, STAGE_POSE_MAX_Y, STAGE_SCENE_KEY, type StagePose } from './stage/stageScene';
import { summonSchedule } from './stage/stageSummon';
import { saveStageScreenshot } from './stage/stageScreenshot';
import type { CharacterHitPart, ModelHitTest } from '../character/vrm/modelHitTest';
import { VrmStage } from '../character/vrm/VrmStage';
import { SharedStageRenderer } from '../character/vrm/SharedStageRenderer';
import { DEFAULT_CAMERA_ZOOM } from '../character/vrm/cameraZoom';
import { CharacterEntryCircle, useCharacterEntryEffect } from '../character/vrm/CharacterEntryEffect';
import { actorIdsFromStack, resolveDragTargetId } from './desktopCastDrag';
import './desktop-pet.css';

import type { CharacterController } from '../character/CharacterController';
import {
  listenDesktopRealtimeSync,
  publishDesktopRealtimeSync
} from '../app/network/realtime/DesktopRealtimeSync';
import { listenVoiceBroadcast, publishVoiceBroadcast } from '../ai/tts/voiceBroadcast';
import { listenVoicePlayback } from '../ai/tts/listenVoicePlayback';
import { createVoiceOnlySpeech } from '../desktop/tauri/voiceOnlySpeech';
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
import { createImportedModelUrl } from '../character/vrm/importedModelUrl';
import { resolveVrmModelOption } from '../character/vrm/assets/vrmModels';
import type { VoiceStreamEvent } from '../app/network/realtime/VoiceStreamProtocol';

const ignoreStatus = () => undefined;
const dragModel = () => window.dispatchEvent(new Event('servant-model-drag'));
/** 拖拽真正需要的字段；React 合成事件结构上即可满足。 */
type PointerStart = { pointerId: number; clientX: number; clientY: number };
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
  /**
   * 该点下被模型盖住的角色及其部位，DOM 栈顶在前。
   *
   * 角色的列（`.desktop-cast-actor`）会彼此重叠，事件落点常常不是鼠标下的那只，所以
   * 右键菜单、窗口穿透和拖拽共用这一套判定：只有该点 DOM 栈里的角色参与比较，栈里谁
   * 先盖住该点就是谁。同一角色的判定结果在一次调用内复用，避免重复走骨骼胶囊。
   */
  const modelAtPoint = (x: number, y: number): { id: string; part: CharacterHitPart } | null => {
    const parts = new Map<string, CharacterHitPart | null>();
    const partAt = (id: string) => {
      if (!parts.has(id)) parts.set(id, actorHitTests.current.get(id)?.(x, y) ?? null);
      return parts.get(id) ?? null;
    };
    const id = resolveDragTargetId(
      actorIdsFromStack(document.elementsFromPoint(x, y)),
      (candidate) => Boolean(partAt(candidate)),
      null
    );
    const part = id ? partAt(id) : null;
    return id && part ? { id, part } : null;
  };
  // 判定只读 `actorHitTests`，所以取首次渲染的闭包即可。
  const hitTest = useRef<ModelHitTest | null>((x, y) => modelAtPoint(x, y)?.part ?? null);
  const { settings, modelUrl } = useDesktopCharacter();
  const cast = useDesktopCast(modelUrl);
  const { meeting, profiles } = useStageMeeting();
  const castActive = Boolean(meeting);
  const [scene, setScene] = useState(loadStageScene);
  const [editing, setEditing] = useState(false);
  const [selectedActorId, setSelectedActorId] = useState('');
  const [lightingPreview, setLightingPreview] = useState<StageLightingPreview | null>(null);
  // 思考与回复状态由多人对话窗口广播过来；舞台按消息携带的角色 ID 显示。
  const [stageActivity, setStageActivity] = useState<StageActivity | null>(null);
  useEffect(() => listenStageReplying(setStageActivity), []);
  const [stageError, setStageError] = useState('');
  /** 拖动时顶到「保头」上限；仅用于拖动期间的即时提示，不进 scene。 */
  const [atHeadLimit, setAtHeadLimit] = useState(false);
  const panKey = useRef(false);
  const stageLayout = scene.layout;
  /**
   * 开舞台时依次召唤：名单上的角色按次序每隔一小段拿到一次召唤权，拿到就播自己的
   * 登场动画（模型没加载完就等加载完再播，不会白播一次空舞台）。
   *
   * 关掉舞台要清空——下次再开得重新召唤一遍。
   */
  const [summoned, setSummoned] = useState<readonly string[]>([]);
  const castKey = cast.map(({ profile }) => profile.id).join(',');
  useEffect(() => {
    if (!castActive) { setSummoned([]); return; }
    const timers = summonSchedule(castKey ? castKey.split(',') : []).map(({ id, atMs }) =>
      window.setTimeout(
        () => setSummoned((current) => (current.includes(id) ? current : [...current, id])),
        atMs
      )
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [castActive, castKey]);
  useEffect(() => {
    const timer = setTimeout(() => {
      try { localStorage.setItem(STAGE_SCENE_KEY, JSON.stringify(scene)); }
      catch { setStageError('舞台设置保存失败，请检查存储空间。'); }
    }, 250);
    return () => clearTimeout(timer);
  }, [scene]);
  const castModeRef = useRef(false);
  const stageTransition = useRef(Promise.resolve());
  const [stageArea, setStageArea] = useState<typeof FULL_STAGE | null>(null);
  useEffect(() => {
    const enabled = castActive;
    if (castModeRef.current === enabled) return;
    castModeRef.current = enabled;
    if (!isTauriDesktop()) { setStageArea(FULL_STAGE); return; }
    setStageArea(null);
    localStorage.setItem('servant.desktopStageMode', String(enabled));
    stageTransition.current = stageTransition.current.then(async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_desktop_stage_mode', { enabled });
      setStageArea(FULL_STAGE);
      // Rust 侧进全屏时已经剥过一次窗体样式，但窗口管理器随后才重算非客户区，
      // 那一圈原生边框常常在那之后又回来——所以这里再补几刀（内部自带重试）。
      if (enabled) void fixStageWindowFrame();
    }).catch((error) => {
      setStageError(`舞台窗口切换失败：${String(error)}`);
      setStageArea(FULL_STAGE);
    }).finally(() => {
      if (!enabled) localStorage.removeItem('servant.desktopStageMode');
    });
  }, [castActive]);
  useEffect(() => {
    if (!castActive) return;
    sharedStageRenderer?.invalidateLayout();
    window.dispatchEvent(new Event('resize'));
  }, [castActive, scene.view, sharedStageRenderer]);
  useEffect(() => {
    const element = root.current;
    const wheel = (event: WheelEvent) => {
      if (!castActive || !editing || !event.ctrlKey || (event.target as Element).closest('.galgame-ui')) return;
      event.preventDefault(); event.stopPropagation();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1);
      setScene((current) => ({ ...current, view: { ...current.view, zoom: bounded(current.view.zoom * Math.exp(-delta * 0.001), 1, 0.5, 2) } }));
    };
    element?.addEventListener('wheel', wheel, { passive: false, capture: true });
    return () => element?.removeEventListener('wheel', wheel, true);
  }, [castActive, editing]);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !(event.target instanceof Element && event.target.closest('input, textarea, select, button, dialog'))) {
        panKey.current = true; if (editing) event.preventDefault();
      }
    };
    const up = () => { panKey.current = false; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', up); };
  }, [editing]);
  const area = stageArea ?? FULL_STAGE;
  const mainIndex = cast.findIndex(({ profile }) => profile.isMain);
  /**
   * 某个角色的姿态。
   *
   * 有存档就恢复上次的位置/大小（`x` / `y` / `zoom` / `z`）；没有存档走**自动摆位**：
   * 横向均分、主角色居中，谁也不用为谁让位。`x` 是模型中心点的百分比。
   */
  const actorPose = (id: string, index: number): StagePose => {
    const saved = stageLayout[id];
    return {
      x: saved?.x ?? autoCastCenterX(index, cast.length, mainIndex, area),
      y: saved?.y ?? area.y,
      zoom: saved?.zoom ?? DEFAULT_CAMERA_ZOOM,
      z: saved?.z ?? index + 1
    };
  };
  const updatePose = (id: string, update: Partial<StagePose>, index: number) =>
    setScene((current) => ({ ...current, layout: { ...current.layout, [id]: { ...actorPose(id, index), ...update } } }));
  /**
   * 开舞台的那一刻给「还没存档」的角色自动摆位并落库；已有存档的角色原样恢复。
   *
   * 只在「舞台从关到开」这一次跑。这样首次打开 = 自动摆位（分开站、主角色居中），
   * 之后打开 = 恢复上次的位置和大小。开着的时候加人走 `actorPose` 的默认落点
   * （同样是自动摆位），但**不会**把已经摆好的人推走。
   */
  const stageOpenedRef = useRef(false);
  useEffect(() => {
    if (!castActive) { stageOpenedRef.current = false; return; }
    if (stageOpenedRef.current) return;
    stageOpenedRef.current = true;
    const ids = castKey ? castKey.split(',') : [];
    if (!ids.length) return;
    setScene((current) => {
      const layout: Record<string, StagePose> = { ...current.layout };
      let changed = false;
      ids.forEach((id, index) => {
        if (layout[id]) return;
        layout[id] = {
          x: autoCastCenterX(index, ids.length, mainIndex, area),
          y: area.y,
          zoom: DEFAULT_CAMERA_ZOOM,
          z: index + 1
        };
        changed = true;
      });
      return changed ? { ...current, layout } : current;
    });
  }, [castActive, castKey, area, mainIndex]);
  /** 这一下按下该作用在哪个角色上：鼠标下的模型，没有模型时退回被按下的那一列。 */
  const dragTargetAt = (point: { clientX: number; clientY: number }, pressedId: string) =>
    modelAtPoint(point.clientX, point.clientY)?.id ?? pressedId;
  /**
   * 开始拖动舞台上的角色。
   *
   * `targetId` 不一定是事件落到的列：列被拖到邻居身上以后就互相重叠，最后拖过的那只
   * 又在按下时被提到最上层，「事件落在 a 的列、鼠标下面是 b 的身体」于是成了常态。
   */
  const beginCastDrag = (targetId: string, event: PointerStart) => {
    const rect = root.current?.getBoundingClientRect();
    const index = cast.findIndex(({ profile: item }) => item.id === targetId);
    const actor = [...(root.current?.querySelectorAll<HTMLElement>('.desktop-cast-actor') ?? [])].find(
      (element) => element.dataset.characterId === targetId
    );
    if (!rect || index < 0 || !actor) return;

    const pose = actorPose(targetId, index);
    const { pointerId, clientX, clientY } = event;
    const original = { x: pose.x, y: pose.y };
    let nextX = pose.x;
    let nextY = pose.y;
    actor.setPointerCapture(pointerId);
    actor.dataset.dragging = 'true';
    updatePose(targetId, { z: Math.max(0, ...Object.values(stageLayout).map((item) => item.z ?? 0)) + 1 }, index);

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if ((moveEvent.buttons & 1) === 0) { done(); return; }
      nextX = Math.max(-20, Math.min(120, original.x + (moveEvent.clientX - clientX) / (rect.width * scene.view.zoom) * 100));
      const wantedY = original.y - (moveEvent.clientY - clientY) / (rect.height * scene.view.zoom) * 100;
      nextY = Math.max(-30, Math.min(STAGE_POSE_MAX_Y, wantedY));
      // `nextX` 是模型中心，列左边缘要减掉半个列宽——列是整屏宽的。
      actor.style.left = `${castColumnLeft(nextX, area)}%`;
      actor.style.bottom = `${nextY}%`;
      // 拖动只改了列的 left/bottom，SharedStageRenderer 的布局是「信号驱动」的：
      // 它靠 MutationObserver / ResizeObserver 观察尺寸与属性变化，而改位置既不改变
      // 尺寸、也不是属性变化，观察不到。不手动置一次脏标记，模型就还画在旧位置，
      // 只有列这个透明容器在动——看起来就是「拖动不跟手」。
      sharedStageRenderer?.invalidateLayout();
      // 再往上就要切头了（列高 = 屏高，列顶一过屏幕顶取景窗就开始裁）：停在 70 并告诉用户为什么。
      setAtHeadLimit(wantedY > STAGE_POSE_MAX_Y);
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
      setAtHeadLimit(false);
      updatePose(targetId, { x: nextX, y: nextY }, index);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', done, true);
    window.addEventListener('pointercancel', done, true);
    window.addEventListener('blur', done);
    actor.addEventListener('lostpointercapture', done);
  };
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
  const actorEnginesRef = useRef(new Map<string, CharacterController>());
  const actorSpeechRef = useRef(new Map<string, DesktopConversationSpeechStream>());
  const pendingVoiceRef = useRef(new Map<string, VoiceStreamEvent[]>());
  /**
   * 没渲染模型、但也在会议里发言的角色的「纯语音」引擎。
   *
   * 开舞台时所有角色都渲染、各自有 stream；不开舞台时 pet 窗口只有主角色，非主角色
   * 的语音事件没有 stream 可接。这里按需给它们建一个只出声的 `SpeechController`
   * （不接口型 / 气泡 / 动作），voiceId 从角色档案里查。
   */
  const voiceOnlyRef = useRef(new Map<string, DesktopConversationSpeechStream>());
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const [activityStatuses, setActivityStatuses] = useState<CharacterActivityStatus[]>([]);
  const actorStatusesRef = useRef(new Map<string, CharacterActivityStatus[]>());
  const actorStatusUnsubscribersRef = useRef(new Map<string, () => void>());
  const [toolResult, setToolResult] = useState<ToolResultEvent | null>(null);
  /**
   * 舞台对话框当前该显示的那一段。
   *
   * 直接从播放流里取，而不是从 `meeting.messages.at(-1)` 取——一轮回复可能有好几
   * 段，落库的 `messages` 是**整轮**一起写的，取 `.at(-1)` 会让舞台永远只显示最后
   * 一段，中间几句根本来不及出现在对白框里。播放流是按段来的，正好是对白框的粒度。
   *
   * `key` 用「消息 id + 段序号」，因为同一条消息的多段共用 messageId。
   */
  const [stageSegment, setStageSegment] = useState<StageSegment | null>(null);
  const reminderQueueRef = useRef<DesktopReminderQueue | null>(null);
  useDesktopWindow(root, hitTest);

  const registerHitTest = useCallback((characterId: string, test: ModelHitTest | null) => {
    if (test) actorHitTests.current.set(characterId, test);
    else actorHitTests.current.delete(characterId);
  }, []);

  const registerEngine = useCallback((characterId: string, next: CharacterController | null) => {
    actorStatusUnsubscribersRef.current.get(characterId)?.();
    actorStatusUnsubscribersRef.current.delete(characterId);
    actorSpeechRef.current.get(characterId)?.dispose();
    actorSpeechRef.current.delete(characterId);
    if (!next) {
      actorEnginesRef.current.delete(characterId);
      actorStatusesRef.current.delete(characterId);
      if (characterId === mainCharacterIdRef.current) setEngine(null);
      return;
    }
    actorEnginesRef.current.set(characterId, next);
    next.interaction.replaceActivityStatuses(actorStatusesRef.current.get(characterId) ?? []);
    actorStatusUnsubscribersRef.current.set(
      characterId,
      next.interaction.subscribeActivityStatuses((statuses) => {
        actorStatusesRef.current.set(characterId, statuses);
        if (characterId === mainCharacterIdRef.current) {
          setActivityStatuses(statuses);
        }
      })
    );
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
      },
      (id, index, segment) => setStageSegment(stageSegmentFromPlayback(id, characterId, index, segment))
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
        const characterId = event.characterId ?? mainCharacterIdRef.current;
        actorStatusesRef.current.set(characterId, event.statuses);
        if (characterId === mainCharacterIdRef.current) {
          setActivityStatuses(event.statuses);
        }
        actorEnginesRef.current.get(characterId)?.interaction.replaceActivityStatuses(event.statuses);
      }
      if (event.type === 'tool-result') {
        if (event.tool !== 'web-search' || !event.success) setToolResult(event);
        const speechEvent = toToolResultSpeechEvent(event);
        if (speechEvent) reminderQueue.handle(speechEvent);
      }
    });
    const unsubscribeVoice = listenVoiceBroadcast((event) => {
      reminderQueue.handleVoiceEvent(event);
    });
    const unsubscribePlayback = listenVoicePlayback((event) => {
      const characterId = event.characterId ?? mainCharacterIdRef.current;
      // 段级表演：对白框、名称旁的表情与动作、打字机都跟着这一份走。
      if (event.type === 'speech-end' || event.type === 'speech-cancel' || event.type === 'speech-playback-completed') {
        setStageSegment(null);
      }
      const stream = actorSpeechRef.current.get(characterId);
      if (stream) stream.handle(event);
      else {
        // 该角色没渲染（非投射时 pet 窗口只有主角色），建一个纯语音引擎兜底，
        // 只出声、不接口型/气泡/动作。找不到角色档案（已移除）才落 pending。
        const profile = profilesRef.current.find((item) => item.id === characterId);
        if (profile) {
          let voiceStream = voiceOnlyRef.current.get(characterId);
          if (!voiceStream) {
            voiceStream = new DesktopConversationSpeechStream(
              createVoiceOnlySpeech(profile.voiceId),
              (type, id) => publishVoiceBroadcast({ type, id, characterId, source: 'conversation' }),
              undefined,
              undefined,
              (id, index, segment) => setStageSegment(stageSegmentFromPlayback(id, characterId, index, segment))
            );
            voiceOnlyRef.current.set(characterId, voiceStream);
          }
          voiceStream.handle(event);
        } else {
          const pending = pendingVoiceRef.current.get(characterId) ?? [];
          pending.push(event);
          pendingVoiceRef.current.set(characterId, pending.slice(-32));
        }
      }
    }, () => {
      actorSpeechRef.current.forEach((stream) => stream.dispose());
      voiceOnlyRef.current.forEach((stream) => stream.dispose());
      voiceOnlyRef.current.clear();
      pendingVoiceRef.current.clear();
      setStageSegment(null);
    });
    void reminderScheduler.start().catch((cause) => console.error('[DesktopReminderScheduler]', cause));
    return () => {
      unsubscribeSync();
      unsubscribeVoice();
      unsubscribePlayback();
      reminderScheduler.dispose();
      if (reminderQueueRef.current === reminderQueue) reminderQueueRef.current = null;
      actorSpeechRef.current.forEach((stream) => stream.dispose());
      actorSpeechRef.current.clear();
      voiceOnlyRef.current.forEach((stream) => stream.dispose());
      voiceOnlyRef.current.clear();
      pendingVoiceRef.current.clear();
      reminderQueue.dispose();
    };
  }, []);

  return (
    <main
      ref={root}
      className="desktop-pet"
      data-stage={castActive}
      data-editing={castActive && editing}
      data-shared-stage={Boolean(sharedStageRenderer)}
      aria-label="Servant 桌面伙伴"
      onPointerDownCapture={(event) => {
        if (!castActive || !editing || !panKey.current || event.button !== 0 || (event.target as Element).closest('.galgame-ui')) return;
        event.preventDefault(); event.stopPropagation();
        const element = event.currentTarget, pointerId = event.pointerId;
        const x = event.clientX, y = event.clientY, initial = scene.view;
        const box = element.getBoundingClientRect();
        element.setPointerCapture(pointerId);
        const move = (event: PointerEvent) => {
          if (event.pointerId !== pointerId) return;
          setScene((current) => ({ ...current, view: { ...initial,
            x: bounded(initial.x + (event.clientX - x) / box.width * 100, 0, -50, 50),
            y: bounded(initial.y + (event.clientY - y) / box.height * 100, 0, -50, 50) } }));
        };
        const done = () => {
          window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', done);
          window.removeEventListener('pointercancel', done); window.removeEventListener('blur', done);
          if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
        };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', done);
        window.addEventListener('pointercancel', done); window.addEventListener('blur', done);
      }}
      onContextMenu={(event) => {
        if (castActive) return;
        event.preventDefault();
        if (
          !root.current?.hasAttribute('data-interactive') &&
          !hitTest.current?.(event.clientX, event.clientY)
        )
          return;
        void openPetContextMenu({ x: event.screenX, y: event.screenY });
      }}
    >
      {castActive && scene.background !== 'transparent' && <div className="galgame-background" style={{
        backgroundImage: backgroundSource(scene.background) ? `url("${backgroundSource(scene.background)}")` : undefined,
        backgroundSize: scene.fit, backgroundPosition: `${scene.backgroundX}% ${scene.backgroundY}%`,
        filter: `brightness(${scene.brightness}) blur(${scene.blur}px)`,
        transform: `translate(${scene.view.x}%, ${scene.view.y}%) scale(${scene.view.zoom})`
      }} />}
      <canvas ref={sharedCanvas} className="desktop-stage-canvas" aria-hidden="true" />
      <div
        className="desktop-cast"
        data-free={castActive}
        data-count={cast.length}
        data-at-head-limit={atHeadLimit || undefined}
        style={{ '--desktop-cast-count': Math.max(1, cast.length),
          transform: castActive ? `translate(${scene.view.x}%, ${scene.view.y}%) scale(${scene.view.zoom})` : undefined
        } as CSSProperties}
      >
        {cast.map(({ profile, modelUrl: actorModelUrl }, index) => {
          if (!sharedStageRenderer && !sharedRendererFailed) return null;
          if (castActive && isTauriDesktop() && !stageArea) return null;
          const pose = actorPose(profile.id, index);
          return (
          <DesktopActorBoundary key={profile.id}>
            <div className="desktop-cast-actor" data-character-id={profile.id} data-free={castActive} data-layer={pose.z}
              data-selected={selectedActorId === profile.id} style={castActive ? {
              left: `${castColumnLeft(pose.x, area)}%`, bottom: `${pose.y}%`, zIndex: pose.z,
              width: `${area.width}%`, height: `${area.height}%`,
              display: scene.hidden.includes(profile.id) ? 'none' : undefined
            } : undefined}
              onPointerDown={castActive ? (event) => {
                if (event.button !== 0 || !event.isPrimary) return;
                const pressedId = event.currentTarget.dataset.characterId;
                if (pressedId) {
                  const hit = modelAtPoint(event.clientX, event.clientY);
                  const target = hit?.id ?? pressedId;
                  if (hit?.part === 'head') actorEnginesRef.current.get(target)?.actions.headClick();
                  setSelectedActorId(target);
                  if (editing) beginCastDrag(target, event);
                }
              } : undefined}
              onWheel={castActive ? (event) => {
                if (!editing || event.ctrlKey) return;
                const target = dragTargetAt(event, profile.id);
                const index = cast.findIndex(({ profile }) => profile.id === target);
                updatePose(target, { zoom: bounded((scene.layout[target]?.zoom ?? 2) * Math.exp(-event.deltaY * 0.001), 2, 0.3, 6) }, index);
              } : undefined}
              onDoubleClick={castActive && editing ? (event) => {
                const pressedId = event.currentTarget.dataset.characterId;
                if (!pressedId) return;
                const targetId = dragTargetAt(event, pressedId);
                const targetIndex = cast.findIndex(({ profile: item }) => item.id === targetId);
                if (targetIndex >= 0) updatePose(targetId, { z: 0 }, targetIndex);
              } : undefined}
            >
              <DesktopActor
              sharedStageRenderer={sharedStageRenderer}
              acceptsUntargetedSpeech={profile.id === mainCharacterId}
              modelUrl={actorModelUrl}
              profile={profile}
              settings={castActive ? { ...settings, renderConfig: (() => {
                const config = actorLighting(scene, profile.id, settings.renderConfig);
                if (!lightingPreview) return config;
                if (lightingPreview.target === 'stage') return { ...config, mainLightIntensity: lightingPreview.config.mainLightIntensity, ambientLightIntensity: lightingPreview.config.ambientLightIntensity, forceUnlitLighting: lightingPreview.config.forceUnlitLighting };
                return lightingPreview.target === profile.id ? { ...lightingPreview.config, ...scene.lighting } : config;
              })() } : settings}
              speechBubbleEnabled={!castActive && hints.speechBubble}
              initialZoom={castActive ? pose.zoom : profile.id === mainCharacterId ? petZoom : undefined}
              controlledZoom={castActive ? pose.zoom : undefined}
              onZoomChange={castActive ? (zoom) => updatePose(profile.id, { zoom }, index) : profile.id === mainCharacterId ? handleZoomChange : undefined}
              wheelZoomEnabled={!castActive && profile.id === mainCharacterId}
              allowWindowDrag={!castActive}
              summon={!castActive || summoned.includes(profile.id)}
              onEngineChange={registerEngine}
              onHitTestChange={registerHitTest}
            />
            </div>
          </DesktopActorBoundary>
          );
        })}
      </div>
      {meeting && <StageControls scene={scene} setScene={setScene} meeting={meeting} profiles={profiles}
        baseLighting={settings.renderConfig} editing={editing} setEditing={setEditing}
        selectedId={selectedActorId} setSelectedId={setSelectedActorId} onLightingPreview={setLightingPreview}
        activity={stageActivity} segment={stageSegment}
        onPlayAction={async (id, actionId) => {
          const engine = actorEnginesRef.current.get(id);
          if (!engine) throw new Error('角色尚未就绪');
          engine.director.interrupt();
          await engine.actionRuntime.play([actionId], { propagateError: true });
        }}
        onStopAction={async (id) => {
          const engine = actorEnginesRef.current.get(id);
          if (!engine) throw new Error('角色尚未就绪');
          engine.director.interrupt();
          engine.actionRuntime.clearBehaviors();
          engine.actionRuntime.returnToIdle();
        }}
        onPoseZoom={(id, zoom) => updatePose(id, { zoom }, cast.findIndex(({ profile }) => profile.id === id))}
        error={stageError} onScreenshot={async () => {
          if (!sharedStageRenderer) throw new Error('舞台渲染器尚未就绪。');
          await saveStageScreenshot(scene, await sharedStageRenderer.captureFrame());
        }} />}
      {!castActive && hints.characterStatus && activityStatuses.length ? (
        <output className="desktop-character-status" aria-live="polite">
          {activityStatuses.map((status) => (
            <span key={status}>{activityStatusLabels[status]}</span>
          ))}
        </output>
      ) : null}
      {!castActive && hints.toolResult && toolResult ? (
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
  controlledZoom?: number;
  wheelZoomEnabled: boolean;
  allowWindowDrag: boolean;
  /** 轮到它登场了：模型就绪就播召唤动画，没就绪等就绪再播。宠物模式下恒为 true。 */
  summon: boolean;
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
  controlledZoom,
  wheelZoomEnabled,
  allowWindowDrag,
  summon,
  onZoomChange,
  onEngineChange,
  onHitTestChange
}: DesktopActorProps) {
  // Model readiness is automatic, not an explicit summon (unlike MagicCircleDemo).
  const entry = useCharacterEntryEffect(false);
  const [entryBounds, setEntryBounds] = useState({ footY: 96, headY: 12 });
  const ttsProvider = useDesktopTtsProvider(profile.voiceId);
  /**
   * 召唤要等两件事都齐：轮到它（`summon`）**且**模型真的加载好了。
   *
   * 只等其中一个都会出问题——只等轮次会对着空列播一次登场动画；只等模型又会让
   * 所有人同时登场，没有「依次」。
   */
  const readyRef = useRef(false);
  const playedRef = useRef(false);
  const summonRef = useRef(summon);
  summonRef.current = summon;
  const playEntry = useCallback(() => {
    if (playedRef.current || !readyRef.current || !summonRef.current) return;
    playedRef.current = true;
    entry.play();
  }, [entry.play]);
  const ready = useCallback(
    (engine: CharacterController) => {
      readyRef.current = true;
      onEngineChange(profile.id, engine);
      playEntry();
    },
    [onEngineChange, playEntry, profile.id]
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
  // 召唤权一到就播；收回（舞台关掉）就复位，下次开舞台还能再召唤一次。
  useEffect(() => {
    if (!summon) { playedRef.current = false; entry.cancel(); return; }
    playEntry();
  }, [entry.cancel, playEntry, summon]);
  useEffect(() => entry.cancel(), [entry.cancel, modelUrl, settings.renderConfig.forceUnlitLighting]);

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
        controlledZoom={controlledZoom}
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
    const urls: ReturnType<typeof createImportedModelUrl>[] = [];
    void listImportedVrms()
      .then((records) => {
        if (disposed) return;
        const next = new Map(
          records.map((record) => {
            const handle = createImportedModelUrl(record.blob);
            urls.push(handle);
            return [record.id, handle.url] as const;
          })
        );
        setImportedUrls(next);
      })
      .catch((error) => console.error('Unable to load meeting VRM models', error));
    return () => {
      disposed = true;
      urls.forEach((handle) => handle.dispose());
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
