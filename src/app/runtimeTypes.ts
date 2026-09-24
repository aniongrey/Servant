import type * as THREE from 'three';
import type { VRMAnimation } from '@pixiv/three-vrm-animation';

export type MotionLoop = 'once' | 'repeat';
export type MotionLayer = string;
export type MotionMaskPreset = string;
export type RuntimeLogLevel = 'info' | 'warn' | 'error';
export type ActionBodyPart = 'Root' | 'LowerBody' | 'Torso' | 'Head' | 'LeftArm' | 'RightArm' | 'Face';
export type ActionPhase = 'idle' | 'enter' | 'hold' | 'exit' | 'oneShot';
export type MotionState = 'idle' | 'emotion' | 'casual';
export type Facing = 'left' | 'right' | 'user';
export type GazeTarget = 'user' | 'avoid' | 'peek';

export interface PersonalityWeights {
  directAffection: number;
  verbalDenial: number;
  physicalLeak: number;
  hideWhenShy: number;
  needComfortWhenAngry: number;
  teaseTolerance: number;
}

export interface MotionMeta {
  bodyParts?: ActionBodyPart[];
  id: string;
  url: string;
  loop: MotionLoop;
  layer?: MotionLayer;
  mask?: MotionMaskPreset;
  trimStartSeconds?: number;
  trimEndSeconds?: number;
  defaultFadeIn: number;
  defaultFadeOut: number;
  interruptible: boolean;
  returnToIdle: boolean;
  tags: string[];
  durationMs: number;
}

export interface LoadedMotion {
  meta: MotionMeta;
  clipName: string;
  clip?: THREE.AnimationClip;
  vrmAnimation?: VRMAnimation;
  vrmBoneMapping?: VrmAnimationBoneMappingReport;
}

export type VrmAnimationHumanoidTrackType = 'rotation' | 'translation';

export interface VrmAnimationBoneMappingEntry {
  humanBoneName: string;
  trackTypes: VrmAnimationHumanoidTrackType[];
  normalizedNodeName?: string;
  rawNodeName?: string;
}

export interface VrmAnimationBoneMappingReport {
  entries: VrmAnimationBoneMappingEntry[];
  sourceTrackCount: number;
  mappedTrackCount: number;
  missingTrackCount: number;
}

export interface MotionLoader {
  load(meta: MotionMeta, signal?: AbortSignal): Promise<LoadedMotion>;
}

export interface ActionTimeRange {
  start: number;
  end?: number;
}

export interface ActionConfig {
  id: string;
  vrma: string;
  parts: ActionBodyPart[];
  state?: MotionState;
  loop?: MotionLoop;
  note?: string;
  oneShot?: boolean;
  split?: [number, number];
  enter?: ActionTimeRange;
  emotion: string[];
}

export interface EmotionActionPreset {
  actions: string[];
}

export type EmotionActionPresetMap = Record<string, EmotionActionPreset>;

export interface ActionPerformancePlan {
  actions: string[];
  expression?: string;
}

export interface ResolvedPlayMotionOptions {
  fadeIn: number;
  fadeOut: number;
  loop: MotionLoop;
  layer: MotionLayer;
  mask?: MotionMaskPreset;
  clampWhenFinished: boolean;
  returnToIdle: boolean;
  signal?: AbortSignal;
}

export interface BodyMotionPlaybackAdapter {
  playMotion(motion: LoadedMotion, options: ResolvedPlayMotionOptions): Promise<void>;
  stop(duration: number, signal?: AbortSignal): Promise<void>;
  setPaused?(paused: boolean): void;
  update?(deltaSeconds: number): void;
}

export interface ExpressionPlaybackAdapter {
  setExpression(id: string, weight: number): void;
}

export interface GazePlaybackAdapter {
  look(target: GazeTarget): void;
}

export interface AccessoryPlaybackAdapter {
  usePreset(preset: AccessoryPreset): void;
  update?(deltaSeconds: number): void;
}

export interface SpatialPlaybackAdapter {
  applySpatial(state: SpatialState): void;
}

export interface PlayMotionOptions {
  fadeIn?: number;
  fadeOut?: number;
  loop?: MotionLoop;
  layer?: MotionLayer;
  mask?: MotionMaskPreset;
  trimStartSeconds?: number;
  trimEndSeconds?: number;
  clampWhenFinished?: boolean;
  returnToIdle?: boolean;
  signal?: AbortSignal;
}

export interface BodyChannelState {
  currentAction?: string;
  phase: 'idle' | 'loading' | 'playing' | 'complete' | 'stopped';
  loop?: MotionLoop;
  activeLayers: Partial<Record<MotionLayer, string>>;
  loadedIds: string[];
  lastFadeMs: number;
}

export interface ActionPartChannelState {
  actionId: string;
  phase: ActionPhase;
}

export interface ActionChannelState {
  activeActions: string[];
  activeParts: Partial<Record<ActionBodyPart, ActionPartChannelState>>;
  lastPlan?: ActionPerformancePlan;
}

export interface SpatialState {
  x: number;
  y: number;
  scale: number;
  facing: Facing;
  offscreen: boolean;
  tailVisible: boolean;
}

export interface ExpressionState {
  id: string;
  weight: number;
  gaze: GazeTarget;
}

export type AccessoryPreset =
  | 'tail_idle'
  | 'tail_slow'
  | 'tail_fast'
  | 'tail_angry'
  | 'tail_shy'
  | 'ear_twitch'
  | 'ear_down';

export interface AccessoryState {
  preset: AccessoryPreset;
}

export interface FxChannelState {
  active: Record<string, unknown>;
}

export interface SpeechState {
  intent?: string;
  text: string;
  /**
   * Speaking action (head motion, speaking pose). Stops `TRAILING_SILENCE_MS`
   * before the audio ends. The mouth does not read it: with an analyser
   * attached it follows the audio itself, and only the fallback mouth motion
   * hangs on this flag.
   */
  speaking: boolean;
  /**
   * Bubble visibility. Covers the whole audio and only drops once playback has
   * really finished, so the bubble outlives `speaking` by design.
   * @see src/character/vrm/speechBubble.ts
   */
  bubbleVisible: boolean;
}

export interface EmotionState {
  anger: number;
  sadness: number;
  happiness: number;
  shyness: number;
}

export interface RelationshipState {
  trust: number;
  attachment: number;
}

export type UserActionIntent =
  | 'missedPromise'
  | 'comfort'
  | 'apology'
  | 'sincereApology'
  | 'emptyApology'
  | 'ignore'
  | 'praise'
  | 'userReturn'
  | 'shyCompliment'
  | 'sadnessSpike'
  | 'happyGift'
  | 'tailPoke'
  | 'workStart'
  | 'goodnight'
  | 'birthdayToday'
  | 'anniversaryToday';

export interface CustomTrigger {
  id: string;
  userId: string;
  phrasePatterns?: string[];
  eventId: string;
  cooldownMs: number;
  enabled: boolean;
  constraints?: {
    minRelationship?: number;
    timeRange?: [string, string];
    maxPerDay?: number;
  };
}

export interface CustomTriggerRuntimeState {
  dayKey: string;
  countToday: number;
  lastTriggeredAt?: number;
}

export interface TriggerChannelState {
  lastInput: string;
  lastBuiltInTrigger?: UserActionIntent;
  lastMatchedTrigger?: string;
  lastEventId?: string;
}

export interface RuntimeLog {
  at: number;
  level: RuntimeLogLevel;
  message: string;
}

export interface DirectorChannelState {
  currentEvent?: {
    id: string;
    title: string;
    priority: number;
    runId: number;
  };
  currentStep: number;
  totalSteps: number;
  cooldowns: Record<string, number>;
}

export interface RuntimeSnapshot {
  body: BodyChannelState;
  action: ActionChannelState;
  spatial: SpatialState;
  expression: ExpressionState;
  accessory: AccessoryState;
  fx: FxChannelState;
  speech: SpeechState;
  emotions: EmotionState;
  relationship: RelationshipState;
  personality: PersonalityWeights;
  counters: Record<string, number>;
  customTriggers: CustomTrigger[];
  customTriggerRuntime: Record<string, CustomTriggerRuntimeState>;
  trigger: TriggerChannelState;
  director: DirectorChannelState;
  logs: RuntimeLog[];
}

export type EventStep =
  | {
      type: 'motion';
      id: string;
      await?: boolean;
      fade?: number;
      loop?: MotionLoop;
      layer?: MotionLayer;
      mask?: MotionMaskPreset;
    }
  | {
      type: 'action';
      actions: string[];
      expression?: string;
      expressionWeight?: number;
      expressionDuration?: number;
      await?: boolean;
    }
  | { type: 'expression'; id: string; weight: number; duration?: number; gaze?: GazeTarget; await?: boolean }
  | { type: 'gaze'; target: GazeTarget; duration?: number; await?: boolean }
  | { type: 'accessory'; preset: AccessoryPreset; transition?: number; await?: boolean }
  | {
      type: 'spatial';
      command: 'moveTo' | 'moveBy' | 'hideOffscreen' | 'returnHome' | 'face';
      args?: unknown;
      duration?: number;
      await?: boolean;
    }
  | { type: 'fx'; id: string; command: 'start' | 'stop'; args?: unknown }
  | { type: 'speech'; intent: string; text?: string; maxChars?: number; await?: boolean }
  | { type: 'wait'; ms: number }
  | { type: 'branch'; condition: string; then: EventStep[]; else?: EventStep[] };

export type InterruptPolicy = 'replace' | 'replaceLowerPriority' | 'ignore';

export interface EventDefinition {
  id: string;
  title: string;
  priority: number;
  interruptPolicy: InterruptPolicy;
  cooldownMs: number;
  maxPerDay?: number;
  steps: EventStep[];
}

export interface RuntimeContext {
  emotions: EmotionState;
  relationship: RelationshipState;
  personality: PersonalityWeights;
  counters: Record<string, number>;
}

export interface SpeechTextProvider {
  getLine(intent: string, context: RuntimeContext, maxChars?: number, signal?: AbortSignal): Promise<string>;
}
