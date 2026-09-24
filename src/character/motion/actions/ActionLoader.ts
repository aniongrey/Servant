import bundledConfig from '../assets/actions/full-body-motion-config.json';
import segments from '../assets/vrma-segments.json';
import type {
  ActionBodyPart,
  ActionConfig,
  MotionMeta,
  MotionState
} from '../../../app/runtimeTypes';
import type { VrmaSegmentConfig } from '../assets/vrmaSegments';
import { findEmotionSegment } from './emotionConfig';

export interface ActionLoaderOptions {
  config?: typeof bundledConfig;
  segments?: VrmaSegmentConfig;
  defaultFadeIn?: number;
  defaultFadeOut?: number;
}
const FULL_BODY_PARTS: ActionBodyPart[] = [
  'Root',
  'LowerBody',
  'Torso',
  'Head',
  'LeftArm',
  'RightArm',
  'Face'
];
const DEFAULT_DURATION_MS = 1200;
type Segment = { start: number; end: number; description: string; parts?: ActionBodyPart[]; loop?: { mode?: string } };

export class ActionLoader {
  readonly config: typeof bundledConfig;
  private readonly actions = new Map<string, ActionConfig>();

  constructor(private readonly options: ActionLoaderOptions = {}) {
    const fullBodyMotionConfig = options.config ?? bundledConfig;
    this.config = fullBodyMotionConfig;
    const idleNames = Array.isArray(fullBodyMotionConfig.idle)
      ? fullBodyMotionConfig.idle
      : [fullBodyMotionConfig.idle];
    const categories: Array<[MotionState, string[]]> = [
      ['emotion', fullBodyMotionConfig.emotions],
      ['casual', fullBodyMotionConfig.casual]
    ];
    const allNames = [...new Set([...idleNames, ...categories.flatMap(([, names]) => names)])];
    for (const name of allNames) {
      const segment = findSegment(name, options.segments);
      if (!segment) continue;
      const state = idleNames.includes(name)
        ? 'idle'
        : categories.find(([, names]) => names.includes(name))?.[0] ?? 'emotion';
      const loop = state === 'idle' && segment.loop?.mode !== 'none' ? 'repeat' : 'once';
      this.actions.set(name, {
        id: name,
        vrma: segment.vrma,
        parts: FULL_BODY_PARTS,
        state,
        loop,
        oneShot: loop === 'once',
        enter: { start: segment.start / 30, end: segment.end / 30 },
        emotion: state === 'emotion' ? [name] : []
      });
    }
    for (const [id, definition] of Object.entries(fullBodyMotionConfig.emotion)) {
      const segment = findEmotionSegment(definition.vrma, (options.segments ?? segments) as VrmaSegmentConfig);
      if (!segment) {
        console.warn(`Invalid emotion segment, skipping action: ${id}`);
        continue;
      }
      this.actions.set(id, {
        id, vrma: definition.vrma.file, parts: segment.parts ?? FULL_BODY_PARTS,
        state: 'emotion', loop: 'once', oneShot: true,
        enter: { start: definition.vrma.start / 30, end: Math.max(definition.vrma.start + 1, definition.vrma.end) / 30 },
        emotion: [definition.purpose], note: definition.purpose
      });
    }
  }
  listActions(): ActionConfig[] {
    return [...this.actions.values()];
  }
  getAction(id: string): ActionConfig {
    const action = this.actions.get(id);
    if (!action) throw new Error(`Unknown action: ${id}`);
    return action;
  }
  crossfadeSeconds(): number {
    return this.config.crossfadeSeconds;
  }
  createMotionMetas(): MotionMeta[] {
    return this.listActions().map((action) => ({
      id: action.id,
      url: normalizeVrmaUrl(action.vrma),
      loop: action.loop ?? 'once',
      layer: 'base',
      bodyParts: Object.hasOwn(this.config.emotion, action.id) ? action.parts : undefined,
      trimStartSeconds: action.enter?.start,
      trimEndSeconds: action.enter?.end,
      defaultFadeIn: this.options.defaultFadeIn ?? this.config.crossfadeSeconds,
      defaultFadeOut: this.options.defaultFadeOut ?? this.config.crossfadeSeconds,
      interruptible: true,
      returnToIdle: false,
      tags: ['full-body', `state:${action.state}`],
      durationMs: action.enter
        ? Math.max(1, Math.round((action.enter.end! - action.enter.start) * 1000))
        : DEFAULT_DURATION_MS
    }));
  }
}

function findSegment(description: string, source: Record<string, Segment[]> = segments as Record<string, Segment[]>): (Segment & { vrma: string }) | undefined {
  for (const [vrma, values] of Object.entries(source as Record<string, Segment[]>)) {
    const segment = values.find((item) => item.description === description);
    if (segment) return { ...segment, vrma };
  }
  return undefined;
}
function normalizeVrmaUrl(vrma: string): string {
  return `/assets/motions/${vrma.replace(/\\/g, '/').replace(/^\/?(public\/)?assets\/motions\//, '')}`;
}
export function actionMotionId(actionId: string): string {
  return actionId;
}
export function actionIdleMotionId(): string {
  return Array.isArray(bundledConfig.idle) ? bundledConfig.idle[0] : bundledConfig.idle;
}
