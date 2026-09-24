import { actionIdleMotionId, type ActionLoader } from './ActionLoader';
import type {
  ActionBodyPart,
  ActionChannelState,
  ActionConfig,
  MotionState
} from '../../../app/runtimeTypes';
import type { BodyMotionController } from '../BodyMotionController';
import type { RuntimeStore } from '../../../app/state/RuntimeStore';
import { throwIfAborted } from '../../../app/utils/delay';
import type { ExpressionController } from '../../expression/ExpressionController';

export interface PlayActionsOptions {
  signal?: AbortSignal;
  /**
   * `false` 时只播身体动作，不写表情与微动作——由调用方（如 LLM `emotion`
   * 的表现层）自己负责脸。默认 `true`，保持直接播放组合动作的原行为。
   */
  presentation?: boolean;
}

interface PlayNamedOptions {
  signal?: AbortSignal;
  /** 说话兜底动作：循环播放且不改表情。 */
  filling?: boolean;
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

export class ActionRuntime {
  private controller: AbortController | undefined;
  private casualTimer: ReturnType<typeof setTimeout> | undefined;
  private protectionUntil = 0;
  private started = false;
  private idleSequenceToken = 0;
  private speaking = false;
  private microdynamics?: { play(id: string): void; stop(): void };

  constructor(
    private readonly loader: ActionLoader,
    private readonly body: BodyMotionController,
    private readonly store: RuntimeStore,
    private readonly expression?: ExpressionController
  ) {}
  setMicroDynamics(runtime: { play(id: string): void; stop(): void }): void {
    this.microdynamics = runtime;
  }
  startSpeaking(): void { this.speaking = true; }
  fillSpeaking(): void {
    if (this.speaking) { this.cancelCurrent(); void this.playNamed(this.loader.config.speaking, 'emotion', { filling: true }); }
  }
  listActions(): ActionConfig[] {
    return this.loader.listActions();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.startIdleSequence();
  }

  notifyInteraction(protectionSeconds = randomBetween(...this.loader.config.interactionProtectionSeconds as [number, number])): void {
    this.protectionUntil = Date.now() + protectionSeconds * 1000;
    this.scheduleCasual();
  }

  playEmotion(id: string): void {
    this.cancelCurrent();
    this.notifyInteraction();
    void this.playNamed(id, 'emotion');
  }
  playCasual(id: string): void {
    this.cancelCurrent();
    void this.playNamed(id, 'casual');
  }

  async play(actions: string[], options: PlayActionsOptions = {}): Promise<void> {
    throwIfAborted(options.signal);
    const id = actions[0];
    if (!id) return;
    this.cancelCurrent();
    const action = this.loader.getAction(id);
    await this.playNamed(action.id, action.state, {
      signal: options.signal,
      presentation: options.presentation
    });
  }

  returnToIdle(): void {
    this.speaking = false;
    this.microdynamics?.stop();
    void this.expression?.set('neutral', 1);
    this.cancelCurrent();
    this.startIdleSequence();
  }

  async stopAll(_duration = 0.12, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    this.cancelCurrent();
    this.speaking = false;
    this.started = false;
    if (this.casualTimer) clearTimeout(this.casualTimer);
    this.microdynamics?.stop();
    void this.expression?.set('neutral', 1);
    this.idleSequenceToken += 1;
    await this.body.stop(this.loader.crossfadeSeconds(), signal);
    this.patchState();
  }

  private async playNamed(
    id: string,
    state: MotionState | undefined,
    options: PlayNamedOptions & Pick<PlayActionsOptions, 'presentation'> = {}
  ): Promise<void> {
    const { signal, filling = false, presentation = true } = options;
    const action = this.loader.getAction(id);
    this.idleSequenceToken += 1;
    const controller = new AbortController();
    this.controller = controller;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const isIdle = state === 'idle';
    const ownsPresentation = !filling && presentation;
    const config = this.loader.config;
    const definition = config.emotion[id as keyof typeof config.emotion];
    if (definition && ownsPresentation) {
      void this.expression?.set(definition.expression, 1);
      for (const micro of definition.microdynamics) this.microdynamics?.play(micro);
    }
    this.patchState(action, state);
    try {
      await this.body.play(action.id, {
        loop: filling ? 'repeat' : action.loop ?? (isIdle ? 'repeat' : 'once'),
        layer: 'base',
        fadeIn: this.loader.crossfadeSeconds(),
        fadeOut: this.loader.crossfadeSeconds(),
        signal: controller.signal
      });
      if (!isIdle && !filling && !controller.signal.aborted) {
        if (this.speaking) { this.fillSpeaking(); return; }
        if (ownsPresentation) void this.expression?.set('neutral', 1);
        this.protectionUntil = Date.now() + randomBetween(...config.interactionProtectionSeconds as [number, number]) * 1000;
        this.startIdleSequence();
      }
    } catch (error) {
      if (!controller.signal.aborted)
        this.store.appendLog(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      signal?.removeEventListener('abort', abort);
      if (this.controller === controller) this.controller = undefined;
    }
  }

  private startIdleSequence(signal?: AbortSignal): void {
    const token = ++this.idleSequenceToken;
    void this.playIdleSequence(token, signal);
  }

  private async playIdleSequence(token: number, signal?: AbortSignal): Promise<void> {
    const idleActions = this.listActions().filter((action) => action.state === 'idle');
    const idle = idleActions[0] ?? this.loader.getAction(actionIdleMotionId());
    this.patchState(idle, 'idle');
    await this.body.play(idle.id, {
      loop: idle.loop ?? 'repeat',
      layer: 'base',
      fadeIn: this.loader.crossfadeSeconds(),
      fadeOut: this.loader.crossfadeSeconds(),
      signal
    });
    this.scheduleCasual();
    if (idle.loop === 'once' && this.started && token === this.idleSequenceToken && !signal?.aborted)
      void this.playIdleSequence(token, signal);
  }

  private scheduleCasual(): void {
    if (!this.started) return;
    if (this.casualTimer) clearTimeout(this.casualTimer);
    const wait = Math.max(0, this.protectionUntil - Date.now()) + randomBetween(...this.loader.config.idleDelaySeconds as [number, number]) * 1000;
    this.casualTimer = setTimeout(() => {
      this.casualTimer = undefined;
      if (Date.now() < this.protectionUntil || this.controller || this.speaking) {
        this.scheduleCasual();
        return;
      }
      const casual = this.listActions().filter((action) => action.state === 'casual');
      const selected = casual[Math.floor(Math.random() * casual.length)];
      if (selected) void this.playNamed(selected.id, 'casual');
    }, wait);
  }

  private cancelCurrent(): void {
    this.controller?.abort();
    this.controller = undefined;
  }
  private patchState(action?: ActionConfig, state?: MotionState): void {
    const active = action
      ? { actionId: action.id, phase: state === 'idle' ? 'idle' : ('oneShot' as const) }
      : undefined;
    const next: ActionChannelState = {
      activeActions: action ? [action.id] : [],
      activeParts: active ? Object.fromEntries(FULL_BODY_PARTS.map((part) => [part, active])) : {}
    };
    this.store.patch({
      action: {
        ...this.store.getSnapshot().action,
        ...next,
        lastPlan: action ? { actions: [action.id] } : undefined
      }
    });
  }
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
