import * as THREE from 'three';
import { actionBodyPartOrder } from './actions/actionBodyParts';
import type {
  ActionBodyPart,
  BodyMotionPlaybackAdapter,
  LoadedMotion,
  MotionLayer,
  ResolvedPlayMotionOptions
} from '../../app/runtimeTypes';
import { getLoopTransitionClip } from './LoopTransition';
import { AbortError, delay, throwIfAborted } from '../../app/utils/delay';
import type { HoldMotionPart, ProceduralHoldMotionAnimator } from './ProceduralHoldMotionAnimator';
import type { ProceduralFootIkAnimator } from '../ik/ProceduralFootIkAnimator';

const FULL_BODY_LAYER: MotionLayer = 'base';

export class ThreeBodyMotionPlaybackAdapter implements BodyMotionPlaybackAdapter {
  private readonly currentActions = new Map<MotionLayer, THREE.AnimationAction>();
  private readonly holdLayers = new Map<MotionLayer, HoldMotionPart>();
  private readonly fadeTimers = new Map<THREE.AnimationAction, ReturnType<typeof setTimeout>>();
  private paused = false;

  constructor(
    private readonly mixer: THREE.AnimationMixer,
    private readonly holdMotion?: ProceduralHoldMotionAnimator,
    private readonly footIk?: ProceduralFootIkAnimator
  ) {}

  async playMotion(motion: LoadedMotion, options: ResolvedPlayMotionOptions): Promise<void> {
    throwIfAborted(options.signal);

    if (!motion.clip) {
      throw new Error(`Motion ${motion.meta.id} has no AnimationClip. Use VrmaLoader for real playback.`);
    }

    const playbackClip = getLoopTransitionClip(motion.clip, options.loop);
    const nextAction = this.mixer.clipAction(playbackClip);
    clearTimeout(this.fadeTimers.get(nextAction));
    this.fadeTimers.delete(nextAction);
    const hasPreviousPose = [...this.currentActions.values()].some((action) => action !== nextAction && action.enabled);
    this.fadeOutConflictingActions(options.layer, nextAction, options.fadeIn);
    const previousAction =
      this.currentActions.get(options.layer) === nextAction
        ? undefined
        : this.currentActions.get(options.layer);
    this.currentActions.set(options.layer, nextAction);
    this.setLayerHold(options.layer, resolveHoldMotionPart(motion, options));

    if (previousAction) {
      this.fadeOutAndStop(previousAction, options.fadeIn);
    }
    nextAction.reset();
    nextAction.enabled = true;
    nextAction.clampWhenFinished = options.clampWhenFinished;
    nextAction.setLoop(
      options.loop === 'repeat' ? THREE.LoopRepeat : THREE.LoopOnce,
      options.loop === 'repeat' ? Infinity : 1
    );
    nextAction.setEffectiveWeight(1);
    // Without an outgoing pose, fading from zero exposes the model's rest pose.
    nextAction.fadeIn(hasPreviousPose ? options.fadeIn : 0);
    nextAction.play();

    if (options.loop === 'repeat') {
      return;
    }

    await this.waitForFinished(nextAction, options.signal);
  }

  async stop(duration: number, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    this.holdLayers.clear();

    const actions = new Set([...this.currentActions.values(), ...this.fadeTimers.keys()]);
    for (const timer of this.fadeTimers.values()) clearTimeout(timer);
    this.fadeTimers.clear();
    for (const action of actions) {
      action.fadeOut(duration);
    }

    await delay(Math.round(duration * 1000), signal);
    for (const action of actions) {
      action.stop();
    }
    this.currentActions.clear();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.mixer.timeScale = paused ? 0 : 1;
  }

  setHoldMicroMotionEnabled(enabled: boolean): void {
    this.holdMotion?.setEnabled(enabled);
  }

  setFootIkEnabled(enabled: boolean): void {
    this.footIk?.setEnabled(enabled);
  }

  update(deltaSeconds: number): void {
    this.footIk?.beforeMixerUpdate();
    this.holdMotion?.beforeMixerUpdate();
    this.mixer.update(deltaSeconds);
    this.holdMotion?.update(this.paused ? 0 : deltaSeconds, [...this.holdLayers.values()]);
    this.footIk?.update(this.paused ? 0 : deltaSeconds);
  }

  private fadeOutConflictingActions(
    layer: MotionLayer,
    nextAction: THREE.AnimationAction,
    duration: number
  ): void {
    if (layer === FULL_BODY_LAYER) {
      for (const [activeLayer, action] of this.currentActions.entries()) {
        if (activeLayer !== FULL_BODY_LAYER && action !== nextAction) {
          this.currentActions.delete(activeLayer);
          this.holdLayers.delete(activeLayer);
          this.fadeOutAndStop(action, duration);
        }
      }
      return;
    }

    const fullBodyAction = this.currentActions.get(FULL_BODY_LAYER);
    if (fullBodyAction && fullBodyAction !== nextAction) {
      this.currentActions.delete(FULL_BODY_LAYER);
      this.holdLayers.delete(FULL_BODY_LAYER);
      this.fadeOutAndStop(fullBodyAction, duration);
    }
  }

  private setLayerHold(layer: MotionLayer, part: HoldMotionPart | undefined): void {
    if (part) {
      this.holdLayers.set(layer, part);
    } else {
      this.holdLayers.delete(layer);
    }
  }

  private fadeOutAndStop(action: THREE.AnimationAction, duration: number): void {
    clearTimeout(this.fadeTimers.get(action));
    this.fadeTimers.delete(action);
    if (duration <= 0) {
      action.stop();
      return;
    }

    action.fadeOut(duration);
    this.fadeTimers.set(action, globalThis.setTimeout(() => {
      this.fadeTimers.delete(action);
      action.stop();
    }, Math.ceil(duration * 1000) + 34));
  }

  private waitForFinished(action: THREE.AnimationAction, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        this.mixer.removeEventListener('finished', onFinished);
        signal?.removeEventListener('abort', onAbort);
      };

      const onFinished = (
        event: THREE.Event<'finished', THREE.AnimationMixer> & { action?: THREE.AnimationAction }
      ): void => {
        if (event.action !== action) {
          return;
        }

        cleanup();
        resolve();
      };

      const onAbort = (): void => {
        cleanup();
        // Keep the last pose while the replacement VRMA loads. Explicit stop()
        // and the replacement's crossfade still release the retained action.
        if ([...this.currentActions.values()].includes(action)) {
          action.paused = true;
          action.stopFading();
          action.setEffectiveWeight(1);
        }
        reject(new AbortError());
      };

      this.mixer.addEventListener('finished', onFinished);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}

function isHoldMotion(motion: LoadedMotion): boolean {
  return motion.meta.tags.includes('phase:hold') || motion.meta.id.endsWith('__hold');
}

function resolveHoldMotionPart(
  motion: LoadedMotion,
  options: ResolvedPlayMotionOptions
): HoldMotionPart | undefined {
  if (!isHoldMotion(motion)) {
    return undefined;
  }

  const mask = options.mask ?? motion.meta.mask;
  if (actionBodyPartOrder.includes(mask as ActionBodyPart)) {
    return mask as ActionBodyPart;
  }
  if (actionBodyPartOrder.includes(options.layer as ActionBodyPart)) {
    return options.layer as ActionBodyPart;
  }
  return 'Full';
}
