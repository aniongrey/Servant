import * as THREE from 'three';
import type { VRM, VRMExpression } from '@pixiv/three-vrm';
import { sampleTrack } from './config';
import { bindMicroDynamicsExpressions } from './expressionBindings';
import type {
  MicroDynamicsAction,
  MicroDynamicsConfig,
  MicroDynamicsDiagnostics,
  MicroDynamicsTrack
} from './types';

interface ActivePlayback {
  action: MicroDynamicsAction;
  elapsedMs: number;
  signs: Map<MicroDynamicsTrack, number>;
}

interface BoneBinding {
  object: THREE.Object3D;
  base: THREE.Euler;
  axis: 'x' | 'y' | 'z';
}

export class MicroDynamicsRuntime {
  private config: MicroDynamicsConfig;
  private stateId = 'neutral';
  private active: ActivePlayback[] = [];
  private expressionNames = new Set<string>();
  private expressionBindings = new Map<string, string>();
  private createdExpressions: VRMExpression[] = [];
  private bones = new Map<string, BoneBinding>();
  private schedulerTimers = new Map<string, number>();
  private autoEnabled = false;
  private currentValues = new Map<string, number>();

  constructor(private readonly vrm: VRM, config: MicroDynamicsConfig, private readonly preserveExpression = false) {
    this.config = config;
    this.rebind();
    this.resetSchedule();
  }

  setConfig(config: MicroDynamicsConfig): void {
    this.stop();
    this.restoreBones();
    this.config = config;
    if (!config.states.some((state) => state.id === this.stateId))
      this.stateId = config.states[0]?.id ?? 'neutral';
    this.rebind();
    this.resetSchedule();
    this.applyFrame(new Map());
  }

  setState(id: string): void {
    if (!this.config.states.some((state) => state.id === id)) throw new Error(`未知状态：${id}`);
    this.stateId = id;
  }

  setAutoEnabled(enabled: boolean): void {
    this.autoEnabled = enabled;
    this.resetSchedule();
  }

  play(actionId: string): void {
    const definition = this.config.actions.find((item) => item.id === actionId);
    if (!definition) throw new Error(`未知动作：${actionId}`);
    const stateValues = this.config.states.find((state) => state.id === this.stateId)?.values;
    const action = {
      ...definition,
      tracks: definition.tracks.map((track) =>
        track.startFromCurrent
          ? {
              ...track,
              keyframes: track.keyframes.map((frame, index) =>
                index === 0
                  ? {
                      ...frame,
                      value: this.currentValues.get(track.target) ?? stateValues?.[track.target] ?? 0
                    }
                  : frame
              )
            }
          : track
      )
    };
    const randomSign = Math.random() < 0.5 ? -1 : 1;
    const targets = new Set(action.tracks.map((track) => track.target));
    this.active = this.active.filter((playback) => !playback.action.tracks.some((track) => targets.has(track.target)));
    this.active.push({
      action,
      elapsedMs: 0,
      signs: new Map(action.tracks.map((track) => [track, track.randomSign ? randomSign : 1]))
    });
  }

  stop(): void {
    this.active = [];
  }

  reset(): void {
    this.active = [];
    this.stateId = this.config.states[0]?.id ?? 'neutral';
    this.currentValues.clear();
    for (const actual of this.expressionBindings.values()) this.vrm.expressionManager?.setValue(actual, 0);
    this.restoreBones();
    this.vrm.expressionManager?.update();
  }

  update(deltaSeconds: number): void {
    this.tickScheduler(deltaSeconds * 1000);
    const overlay = new Map<string, number>();
    for (const playback of this.active) {
      playback.elapsedMs += deltaSeconds * 1000;
      const progress = Math.min(1, playback.elapsedMs / playback.action.durationMs);
      const eased = applyEasing(progress, playback.action.easing);
      for (const track of playback.action.tracks) {
        overlay.set(track.target, sampleTrack(track, eased) * (playback.signs.get(track) ?? 1));
      }
    }
    this.active = this.active.filter((playback) => playback.elapsedMs < playback.action.durationMs);
    this.applyFrame(overlay);
  }

  diagnostics(): MicroDynamicsDiagnostics {
    return {
      expressionBindings: [...this.expressionBindings].map(([logical, actual]) => ({
        logical,
        actual,
        available: this.config.bindings.morphs?.[logical]
          ? Boolean(this.vrm.expressionManager?.getExpression(actual)?.binds.length)
          : this.expressionNames.has(actual)
      })),
      boneBindings: Object.entries(this.config.bindings.bones).map(([logical, binding]) => ({
        logical,
        actual: `${binding.node} · ${binding.axis.toUpperCase()}`,
        available: this.bones.has(logical)
      }))
    };
  }

  getSnapshot(): { stateId: string; actionId: string | null; autoEnabled: boolean } {
    return { stateId: this.stateId, actionId: this.active.at(-1)?.action.id ?? null, autoEnabled: this.autoEnabled };
  }

  dispose(): void {
    this.reset();
    this.clearCreatedExpressions();
  }

  private rebind(): void {
    this.clearCreatedExpressions();
    const expressions = bindMicroDynamicsExpressions(this.vrm, this.config);
    this.expressionBindings = expressions.bindings;
    this.createdExpressions = expressions.created;
    this.expressionNames = new Set(Object.keys(this.vrm.expressionManager?.expressionMap ?? {}));
    this.bones.clear();
    for (const [logical, binding] of Object.entries(this.config.bindings.bones)) {
      const object = findBoundObject(this.vrm, binding.node);
      if (object) this.bones.set(logical, { object, base: object.rotation.clone(), axis: binding.axis });
    }
  }

  private clearCreatedExpressions(): void {
    for (const expression of this.createdExpressions) {
      expression.clearAppliedWeight();
      this.vrm.expressionManager?.unregisterExpression(expression);
    }
    this.createdExpressions = [];
  }

  private restoreBones(): void {
    for (const binding of this.bones.values()) binding.object.rotation.copy(binding.base);
    this.vrm.humanoid?.update();
  }

  private applyFrame(overlay: Map<string, number>): void {
    const state = this.config.states.find((item) => item.id === this.stateId);
    const values = new Map(Object.entries(state?.values ?? {}));
    for (const [target, value] of overlay) values.set(target, value);
    this.currentValues = values;
    const manager = this.vrm.expressionManager;
    if (manager) {
      const actualValues = new Map<string, number>();
      for (const [logical, actual] of this.expressionBindings) {
        if (this.expressionNames.has(actual)) {
          actualValues.set(
            actual,
            Math.max(actualValues.get(actual) ?? 0, clamp01(values.get(logical) ?? 0))
          );
        }
      }
      const gazeX = values.get('gazeX') ?? 0;
      const leftName = this.config.bindings.expressions.lookLeft;
      const rightName = this.config.bindings.expressions.lookRight;
      if (gazeX < 0 && leftName) actualValues.set(leftName, clamp01(-gazeX));
      if (gazeX > 0 && rightName) actualValues.set(rightName, clamp01(gazeX));
      for (const [actual, weight] of actualValues) {
        const facial = ['neutral', 'happy', 'angry', 'sad', 'surprised', 'relaxed', 'fun', 'aa'].includes(actual);
        manager.setValue(actual, facial && this.preserveExpression ? Math.max(manager.getValue(actual) ?? 0, weight) : weight);
      }
      manager.update();
    }
    for (const binding of this.bones.values()) binding.object.rotation.copy(binding.base);
    for (const [logical, binding] of this.bones) {
      const degrees = values.get(logical) ?? 0;
      binding.object.rotation[binding.axis] += THREE.MathUtils.degToRad(degrees);
    }
    this.vrm.humanoid?.update();
  }

  private resetSchedule(): void {
    this.schedulerTimers.clear();
    for (const rule of this.config.scheduler.rules)
      this.schedulerTimers.set(rule.action, randomBetween(rule.intervalMs));
  }

  private tickScheduler(deltaMs: number): void {
    if (!this.autoEnabled || !this.config.scheduler.enabled || this.active.length) return;
    for (const rule of this.config.scheduler.rules) {
      const remaining = (this.schedulerTimers.get(rule.action) ?? randomBetween(rule.intervalMs)) - deltaMs;
      if (remaining > 0) {
        this.schedulerTimers.set(rule.action, remaining);
        continue;
      }
      this.schedulerTimers.set(rule.action, randomBetween(rule.intervalMs));
      if (Math.random() <= rule.probability) {
        this.play(rule.action);
        break;
      }
    }
  }
}

function applyEasing(value: number, easing: MicroDynamicsAction['easing']): number {
  if (easing === 'easeIn') return value * value;
  if (easing === 'easeOut') return 1 - (1 - value) ** 2;
  if (easing === 'easeInOut') return value < 0.5 ? 2 * value * value : 1 - (-2 * value + 2) ** 2 / 2;
  return value;
}

function randomBetween(range: [number, number]): number {
  return range[0] + Math.random() * (range[1] - range[0]);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function findBoundObject(vrm: VRM, configuredName: string): THREE.Object3D | undefined {
  if (configuredName.startsWith('@humanoid:')) {
    const boneName = configuredName.slice('@humanoid:'.length);
    return vrm.humanoid?.getNormalizedBoneNode(boneName as any) ?? undefined;
  }
  const exact = vrm.scene.getObjectByName(configuredName);
  if (exact) return exact;
  const normalized = normalizeObjectName(configuredName);
  let match: THREE.Object3D | undefined;
  vrm.scene.traverse((object) => {
    if (!match && normalizeObjectName(object.name) === normalized) match = object;
  });
  return match;
}

function normalizeObjectName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
