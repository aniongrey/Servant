import motions from '../character/motion/assets/manifest.json';
import angryTsundere from '../event/events/scripts/angry_tsundere_001.json';
import anniversaryToday from '../event/events/scripts/anniversary_today_001.json';
import birthdayToday from '../event/events/scripts/birthday_today_001.json';
import dailyPraise from '../event/events/scripts/daily_praise_001.json';
import goodnightRitual from '../event/events/scripts/goodnight_ritual_01.json';
import happyOverflow from '../event/events/scripts/happy_overflow_001.json';
import jumpSmileWave from '../event/events/scripts/jump_smile_wave_001.json';
import poe2DivineDrop from '../event/events/scripts/poe2_divine_drop_001.json';
import sadWater from '../event/events/scripts/sad_water_001.json';
import shyHideScreen from '../event/events/scripts/shy_hide_screen_001.json';
import tailPokePeek from '../event/events/scripts/tail_poke_peek_001.json';
import welcomeHomeCustom from '../event/events/scripts/welcome_home_custom_01.json';
import workCompanion from '../event/events/scripts/work_companion_01.json';
import speechCatalog from './tts/assets/intents.json';
import gameEventReactionRules from '../event/events/game/assets/reaction-rules.json';
import { ActionLoader } from '../character/motion/actions/ActionLoader';
import { ActionRuntime } from '../character/motion/actions/ActionRuntime';
import { ReplyShortActionRuntime } from '../character/motion/reply/ReplyShortActionRuntime';
import { AccessoryMotionController } from '../character/motion/AccessoryMotionController';
import { BodyMotionController } from '../character/motion/BodyMotionController';
import { ExpressionController } from '../character/expression/ExpressionController';
import { FxController } from '../character/motion/FxController';
import { GazeController } from '../character/expression/GazeController';
import { SpatialController } from '../character/motion/SpatialController';
import { SpeechController } from './tts/SpeechController';
import { resolveConfiguredSpeech } from './tts/resolveConfiguredSpeech';
import { TriggerEngine, type CustomTriggerInput } from '../event/events/custom/TriggerEngine';
import { EmotionEngine, clamp01 } from '../character/expression/EmotionEngine';
import { EventDirector } from '../event/EventDirector';
import { EventRunner } from '../event/EventRunner';
import { EventBus, GameEventReactionDispatcher } from '../event/events/game/index';
import type { GameEvent, GameEventAdapter, GameEventReactionRule } from '../event/events/game/index';
import { MockVrmaLoader } from '../character/motion/MockVrmaLoader';
import { MotionAssetRegistry } from '../character/motion/MotionAssetRegistry';
import { RuntimeStore } from '../app/state/RuntimeStore';
import {
  CharacterInteractionController,
  type CharacterInteractionEffects
} from '../character/interaction/index';
import { DisabledTtsProvider } from './tts/DisabledTtsProvider';
import { TtsManager } from './tts/TtsManager';
import type { TtsProvider } from './tts/types';
import { LocalStorageSoulStorage, SoulManager } from '../soul';
import type {
  BodyMotionPlaybackAdapter,
  CustomTrigger,
  EventDefinition,
  AccessoryPlaybackAdapter,
  ExpressionPlaybackAdapter,
  GazePlaybackAdapter,
  MotionLoader,
  MotionMeta,
  PlayMotionOptions,
  RuntimeContext,
  RuntimeSnapshot,
  SpatialPlaybackAdapter
} from '../app/runtimeTypes';

export interface AgentRuntime {
  store: RuntimeStore;
  registry: MotionAssetRegistry;
  actionLoader: ActionLoader;
  actionRuntime: ActionRuntime;
  replyShortActions: ReplyShortActionRuntime;
  director: EventDirector;
  emotion: EmotionEngine;
  trigger: TriggerEngine;
  speech: SpeechController;
  tts: TtsManager;
  interaction: CharacterInteractionController;
  soul: SoulManager;
  /** @deprecated Use soul. */
  characterState: SoulManager;
  expression: ExpressionController;
  gameEvents: {
    bridge: EventBus;
    reactions: GameEventReactionDispatcher;
  };
  update(deltaSeconds: number): void;
  actions: {
    missedPromise(): void;
    comfort(): void;
    apology(): void;
    praise(): void;
    ignore(): void;
    userReturn(): void;
    shyCompliment(): void;
    sadnessSpike(): void;
    happyGift(): void;
    tailPoke(): void;
    workStart(): void;
    goodnight(): void;
    birthdayToday(): void;
    anniversaryToday(): void;
    forceEvent(eventId: string): void;
    submitText(input: string): void;
    addCustomTrigger(input: CustomTriggerInput): CustomTrigger;
    removeCustomTrigger(id: string): void;
    toggleCustomTrigger(id: string): void;
    interrupt(): void;
    skipStep(): void;
    replayStep(): void;
    replayEvent(): void;
    playActions(actions: string[], expression?: string): void;
    playEmotion(id: string): void;
    stopActions(duration?: number): void;
    playMotion(id: string, options?: PlayMotionOptions): void;
    stopMotion(duration?: number): void;
    setMotionPaused(paused: boolean): void;
    updateEmotion(key: keyof RuntimeSnapshot['emotions'], value: number): void;
    updateRelationship(key: keyof RuntimeSnapshot['relationship'], value: number): void;
    updatePersonality(key: keyof RuntimeSnapshot['personality'], value: number): void;
    dispatchGameEvent(event: GameEvent): void;
    simulatePOE2DivineDrop(): void;
    setMusicPlaying(playing: boolean): void;
    headClick(): void;
    greeting(): void;
    enqueueReminder(id: string, reminder: ReminderTurn | string): Promise<void>;
  };
}

export interface ReminderTurn {
  message?: string;
  speech?: string;
  action?: string;
  emotion?: string;
  intensity?: number;
}

export interface CreateAgentRuntimeOptions {
  motionLoader?: MotionLoader;
  bodyPlaybackAdapter?: BodyMotionPlaybackAdapter;
  expressionPlaybackAdapter?: ExpressionPlaybackAdapter;
  gazePlaybackAdapter?: GazePlaybackAdapter;
  accessoryPlaybackAdapter?: AccessoryPlaybackAdapter;
  spatialPlaybackAdapter?: SpatialPlaybackAdapter;
  extraMotions?: MotionMeta[];
  initialSnapshot?: RuntimeSnapshot;
  persist?: boolean;
  ttsProvider?: TtsProvider;
  soulManager?: SoulManager;
  /** @deprecated Use soulManager. */
  characterStateManager?: SoulManager;
  gameEventAdapters?: GameEventAdapter[];
  gameEventReactionRules?: GameEventReactionRule[];
  interactionEffects?: CharacterInteractionEffects;
}

export function createAgentRuntime(options: CreateAgentRuntimeOptions = {}): AgentRuntime {
  const store = new RuntimeStore(options.initialSnapshot ?? loadLocalSnapshot());
  const actionLoader = new ActionLoader();
  const registry = new MotionAssetRegistry(
    [...(motions as MotionMeta[]), ...actionLoader.createMotionMetas(), ...(options.extraMotions ?? [])],
    options.motionLoader ?? new MockVrmaLoader()
  );

  const body = new BodyMotionController(registry, store, options.bodyPlaybackAdapter);
  const expression = new ExpressionController(store, options.expressionPlaybackAdapter);
  const actionRuntime = new ActionRuntime(actionLoader, body, store, expression);
  const replyShortActions = new ReplyShortActionRuntime(actionRuntime);
  const tts = new TtsManager(options.ttsProvider ?? new DisabledTtsProvider(), store);
  const soul = options.soulManager ?? options.characterStateManager ?? createDefaultSoulManager();
  const speech = new SpeechController(speechCatalog, store, 520, tts, resolveConfiguredSpeech);
  const controllers = {
    action: actionRuntime,
    body,
    spatial: new SpatialController(store, options.spatialPlaybackAdapter),
    expression,
    gaze: new GazeController(store, options.gazePlaybackAdapter),
    accessory: new AccessoryMotionController(store, options.accessoryPlaybackAdapter),
    fx: new FxController(store),
    speech
  };

  const runner = new EventRunner(controllers, store);
  const director = new EventDirector(eventDefinitions, runner, controllers, store);
  const emotion = new EmotionEngine(store);
  const trigger = new TriggerEngine(store, director, emotion);
  const interaction = new CharacterInteractionController(
    actionRuntime,
    speech,
    store,
    options.interactionEffects
  );
  const gameEventBridge = new EventBus(store);
  const gameEventReactions = new GameEventReactionDispatcher(
    options.gameEventReactionRules ?? (gameEventReactionRules as GameEventReactionRule[]),
    director,
    store
  );
  gameEventBridge.onEvent(async (event) => {
    await gameEventReactions.dispatch(event);
  });
  for (const adapter of options.gameEventAdapters ?? []) {
    gameEventBridge.registerAdapter(adapter);
  }

  if (options.persist !== false) {
    store.subscribe(() => saveLocalSnapshot(store.getSnapshot()));
  }

  return {
    store,
    registry,
    actionLoader,
    actionRuntime,
    replyShortActions,
    director,
    emotion,
    trigger,
    speech,
    tts,
    interaction,
    soul,
    characterState: soul,
    expression: controllers.expression,
    gameEvents: {
      bridge: gameEventBridge,
      reactions: gameEventReactions
    },
    update(deltaSeconds: number) {
      controllers.body.update(deltaSeconds);
      controllers.accessory.update(deltaSeconds);
      emotion.tick(deltaSeconds);
      soul.tick(deltaSeconds * 1000);
    },
    actions: {
      missedPromise() {
        void trigger.fire('missedPromise');
      },
      comfort() {
        void trigger.fire('comfort');
      },
      apology() {
        void trigger.fire('apology');
      },
      praise() {
        void trigger.fire('praise');
      },
      ignore() {
        void trigger.fire('ignore');
      },
      userReturn() {
        void trigger.fire('userReturn');
      },
      shyCompliment() {
        void trigger.fire('shyCompliment');
      },
      sadnessSpike() {
        void trigger.fire('sadnessSpike');
      },
      happyGift() {
        void trigger.fire('happyGift');
      },
      tailPoke() {
        void trigger.fire('tailPoke');
      },
      workStart() {
        void trigger.fire('workStart');
      },
      goodnight() {
        void trigger.fire('goodnight');
      },
      birthdayToday() {
        void trigger.fire('birthdayToday');
      },
      anniversaryToday() {
        void trigger.fire('anniversaryToday');
      },
      forceEvent(eventId) {
        void director.play(eventId, contextFrom(store), { force: true });
      },
      submitText(input) {
        void trigger.submitText(input);
      },
      addCustomTrigger(input) {
        return trigger.addCustomTrigger(input);
      },
      removeCustomTrigger(id) {
        trigger.removeCustomTrigger(id);
      },
      toggleCustomTrigger(id) {
        trigger.toggleCustomTrigger(id);
      },
      interrupt() {
        director.interrupt();
      },
      skipStep() {
        director.skipStep();
      },
      replayStep() {
        director.replayStep();
      },
      replayEvent() {
        director.replayLastEvent();
      },
      playActions(actions, expression) {
        director.interrupt();
        if (expression) {
          void controllers.expression.set(expression, 0.9, 80).catch((error: unknown) => {
            store.appendLog(error instanceof Error ? error.message : String(error), 'error');
          });
        }
        void controllers.action.play(actions).catch((error: unknown) => {
          store.appendLog(error instanceof Error ? error.message : String(error), 'error');
        });
      },
      playEmotion(id) {
        if (!actionLoader.listActions().some((action) => action.id === id)) return;
        void actionRuntime.play([id]);
      },
      stopActions(duration = 0.12) {
        director.interrupt();
        void controllers.action.stopAll(duration).catch((error: unknown) => {
          store.appendLog(error instanceof Error ? error.message : String(error), 'error');
        });
      },
      playMotion(id, playOptions) {
        director.interrupt();
        controllers.body.setPaused(false);
        void controllers.body.play(id, playOptions).catch((error: unknown) => {
          store.appendLog(error instanceof Error ? error.message : String(error), 'error');
        });
      },
      stopMotion(duration = 0.18) {
        director.interrupt();
        void controllers.body.stop(duration).catch((error: unknown) => {
          store.appendLog(error instanceof Error ? error.message : String(error), 'error');
        });
      },
      setMotionPaused(paused) {
        controllers.body.setPaused(paused);
      },
      updateEmotion(key, value) {
        store.mutate((snapshot) => {
          snapshot.emotions[key] = clamp01(value);
        });
      },
      updateRelationship(key, value) {
        store.mutate((snapshot) => {
          snapshot.relationship[key] = clamp01(value);
        });
      },
      updatePersonality(key, value) {
        store.mutate((snapshot) => {
          snapshot.personality[key] = clamp01(value);
        });
      },
      dispatchGameEvent(event) {
        gameEventBridge.emit(event);
      },
      simulatePOE2DivineDrop() {
        gameEventBridge.emit({
          type: 'LOOT_DROP',
          game: 'poe2',
          timestamp: Date.now(),
          source: 'debug',
          item: 'Divine Orb',
          tier: 'legendary',
          rarity: 90,
          priority: 90
        });
      },
      setMusicPlaying(playing) {
        interaction.setMusicPlaying(playing);
      },
      headClick() {
        interaction.onHeadClick();
      },
      greeting() {
        interaction.onGreeting();
      },
      enqueueReminder(id, reminder) {
        const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96) || 'reminder';
        const payload: ReminderTurn = typeof reminder === 'string' ? { message: reminder } : reminder;
        const speech = (payload.speech ?? payload.message ?? '').trim().slice(0, 500);
        const action = payload.action?.trim();
        const emotion = payload.emotion?.trim();
        const steps: EventDefinition['steps'] = [];
        if (action) {
          steps.push({ actions: [action], expression: emotion || undefined, type: 'action', await: true });
        } else if (emotion) {
          steps.push({
            type: 'expression',
            id: emotion,
            weight: Math.min(1, Math.max(0.2, payload.intensity ?? 0.8)),
            await: true
          });
        }
        if (speech) {
          steps.push({ type: 'speech', intent: 'scheduled_reminder', text: speech, await: true });
        }
        if (steps.length === 0) return Promise.resolve();
        return director.enqueue(
          {
            id: `scheduled_reminder_${safeId}`,
            title: '定时提醒',
            priority: 0,
            interruptPolicy: 'ignore',
            cooldownMs: 0,
            steps
          },
          contextFrom(store)
        );
      }
    }
  };
}

function createDefaultSoulManager(): SoulManager {
  if (typeof globalThis.localStorage === 'undefined') return new SoulManager({ autoSave: false });
  const manager = new SoulManager({ characterId: 'shiro', storage: new LocalStorageSoulStorage() });
  manager.load();
  return manager;
}

export const eventDefinitions = [
  jumpSmileWave,
  angryTsundere,
  shyHideScreen,
  sadWater,
  happyOverflow,
  tailPokePeek,
  dailyPraise,
  welcomeHomeCustom,
  workCompanion,
  goodnightRitual,
  birthdayToday,
  anniversaryToday,
  poe2DivineDrop
] as EventDefinition[];

export function contextFrom(store: RuntimeStore): RuntimeContext {
  const snapshot = store.getSnapshot();
  return {
    emotions: snapshot.emotions,
    relationship: snapshot.relationship,
    personality: snapshot.personality,
    counters: snapshot.counters
  };
}

const STORAGE_KEY = 'character-drama-engine:v0.1';

function loadLocalSnapshot(): RuntimeSnapshot | undefined {
  if (typeof localStorage === 'undefined') {
    return undefined;
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return undefined;
  }

  try {
    return restorePersistedSnapshot(JSON.parse(raw) as RuntimeSnapshot);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return undefined;
  }
}

function restorePersistedSnapshot(snapshot: RuntimeSnapshot): RuntimeSnapshot {
  return {
    ...snapshot,
    body: {
      ...snapshot.body,
      phase: 'idle',
      currentAction: undefined,
      loop: undefined,
      activeLayers: {}
    },
    action: {
      activeActions: [],
      activeParts: {},
      lastPlan: snapshot.action?.lastPlan
    },
    director: {
      currentStep: 0,
      totalSteps: 0,
      cooldowns: {}
    },
    speech: {
      ...snapshot.speech,
      speaking: false,
      bubbleVisible: false
    }
  };
}

function saveLocalSnapshot(snapshot: RuntimeSnapshot): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...snapshot,
      director: {
        currentStep: 0,
        totalSteps: 0,
        cooldowns: {}
      },
      speech: {
        ...snapshot.speech,
        speaking: false,
        bubbleVisible: false
      },
      logs: snapshot.logs.slice(0, 20)
    })
  );
}
