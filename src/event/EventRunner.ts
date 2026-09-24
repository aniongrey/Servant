import type { EventDefinition, EventStep, RuntimeContext } from '../app/runtimeTypes';
import type { ActionRuntime } from '../character/motion/actions/ActionRuntime';
import type { BodyMotionController } from '../character/motion/BodyMotionController';
import type { SpatialController } from '../character/motion/SpatialController';
import type { ExpressionController } from '../character/expression/ExpressionController';
import type { AccessoryMotionController } from '../character/motion/AccessoryMotionController';
import type { FxController } from '../character/motion/FxController';
import type { GazeController } from '../character/expression/GazeController';
import type { SpeechController } from '../ai/tts/SpeechController';
import type { RuntimeStore } from '../app/state/RuntimeStore';
import { evaluateCondition } from './conditions';
import { eventRuntimeConfig } from './eventRuntimeConfig';
import { delay, isAbortError, throwIfAborted } from '../app/utils/delay';

export interface EventRunnerControllers {
  action: ActionRuntime;
  body: BodyMotionController;
  spatial: SpatialController;
  expression: ExpressionController;
  gaze: GazeController;
  accessory: AccessoryMotionController;
  fx: FxController;
  speech: SpeechController;
}

type StepControlMode = 'skip' | 'replay';

interface StepControl {
  controller: AbortController;
  mode?: StepControlMode;
  dispose(): void;
}

export class EventRunner {
  private currentStepControl?: StepControl;

  constructor(private readonly controllers: EventRunnerControllers, private readonly store: RuntimeStore) {}

  skipCurrentStep(): boolean {
    if (!this.currentStepControl || this.currentStepControl.controller.signal.aborted) {
      return false;
    }

    this.currentStepControl.mode = 'skip';
    this.currentStepControl.controller.abort();
    return true;
  }

  replayCurrentStep(): boolean {
    if (!this.currentStepControl || this.currentStepControl.controller.signal.aborted) {
      return false;
    }

    this.currentStepControl.mode = 'replay';
    this.currentStepControl.controller.abort();
    return true;
  }

  async run(event: EventDefinition, context: RuntimeContext, signal: AbortSignal): Promise<void> {
    await this.runSteps(event.steps, context, signal, event.steps.length);
  }

  private async runSteps(
    steps: EventStep[],
    context: RuntimeContext,
    signal: AbortSignal,
    totalSteps: number
  ): Promise<void> {
    let index = 0;
    while (index < steps.length) {
      throwIfAborted(signal);
      this.store.patch({
        director: {
          ...this.store.getSnapshot().director,
          currentStep: index + 1,
          totalSteps
        }
      });

      const control = this.createStepControl(signal);
      this.currentStepControl = control;

      try {
        await this.runStep(steps[index] as EventStep, context, control.controller.signal, totalSteps);
      } catch (error: unknown) {
        if (isAbortError(error) && control.mode) {
          this.store.appendLog(
            `${control.mode === 'skip' ? 'Skipped' : 'Replayed'} step ${index + 1}`,
            'warn'
          );
          if (control.mode === 'replay') {
            continue;
          }
          index += 1;
          continue;
        }
        throw error;
      } finally {
        control.dispose();
        if (this.currentStepControl === control) {
          this.currentStepControl = undefined;
        }
      }

      index += 1;
    }
  }

  private async runStep(
    step: EventStep,
    context: RuntimeContext,
    signal: AbortSignal,
    totalSteps: number
  ): Promise<void> {
    switch (step.type) {
      case 'action':
        await this.maybeAwait(this.runActionStep(step, signal), step.await);
        return;

      case 'motion':
        await this.maybeAwait(
          this.controllers.body.play(step.id, {
            fadeIn: step.fade,
            fadeOut: step.fade,
            loop: step.loop,
            layer: step.layer,
            mask: step.mask,
            signal
          }),
          step.await
        );
        return;

      case 'expression':
        await this.maybeAwait(
          this.controllers.expression.set(step.id, step.weight, step.duration, step.gaze, signal),
          step.await
        );
        return;

      case 'gaze':
        await this.maybeAwait(this.controllers.gaze.look(step.target, step.duration, signal), step.await);
        return;

      case 'accessory':
        await this.maybeAwait(
          this.controllers.accessory.usePreset(step.preset, step.transition, signal),
          step.await
        );
        return;

      case 'spatial':
        await this.maybeAwait(this.runSpatialStep(step, signal), step.await);
        return;

      case 'fx':
        if (step.command === 'start') {
          this.controllers.fx.start(step.id, step.args);
        } else {
          this.controllers.fx.stop(step.id);
        }
        return;

      case 'speech':
        await this.maybeAwait(
          step.text === undefined
            ? this.controllers.speech.say(step.intent, step.maxChars, signal)
            : this.controllers.speech.sayText(step.text, { intent: step.intent, signal }),
          step.await
        );
        return;

      case 'wait':
        await delay(step.ms, signal);
        return;

      case 'branch': {
        const branchSteps = evaluateCondition(step.condition, context) ? step.then : step.else ?? [];
        await this.runSteps(branchSteps, context, signal, totalSteps);
        return;
      }
    }
  }

  private async runSpatialStep(
    step: Extract<EventStep, { type: 'spatial' }>,
    signal: AbortSignal
  ): Promise<void> {
    switch (step.command) {
      case 'moveTo':
        await this.controllers.spatial.moveTo(asPoint(step.args), step.duration ?? 300, signal);
        return;
      case 'moveBy':
        await this.controllers.spatial.moveBy(asPoint(step.args), step.duration ?? 300, signal);
        return;
      case 'hideOffscreen': {
        const args = asRecord(step.args);
        const side = args.side === 'left' ? 'left' : 'right';
        await this.controllers.spatial.hideOffscreen(side, args.tailVisible !== false, signal);
        return;
      }
      case 'returnHome':
        await this.controllers.spatial.returnToHome(signal);
        return;
      case 'face': {
        const args = asRecord(step.args);
        const direction = args.direction === 'left' || args.direction === 'right' ? args.direction : 'user';
        this.controllers.spatial.face(direction);
        return;
      }
    }
  }

  private async runActionStep(
    step: Extract<EventStep, { type: 'action' }>,
    signal: AbortSignal
  ): Promise<void> {
    const tasks: Promise<void>[] = [this.controllers.action.play(step.actions, { signal })];

    if (step.expression) {
      tasks.push(
        this.controllers.expression.set(
          step.expression,
          step.expressionWeight ?? 0.9,
          step.expressionDuration ?? 80,
          undefined,
          signal
        )
      );
    }

    await Promise.all(tasks);
  }

  private createStepControl(parentSignal: AbortSignal): StepControl {
    const controller = new AbortController();
    const onParentAbort = (): void => {
      controller.abort();
    };

    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }

    return {
      controller,
      dispose() {
        parentSignal.removeEventListener('abort', onParentAbort);
      }
    };
  }

  private async maybeAwait(
    promise: Promise<void>,
    shouldAwait: boolean = eventRuntimeConfig.defaultStepAwait
  ): Promise<void> {
    if (shouldAwait) {
      await promise;
      return;
    }

    promise.catch((error: unknown) => {
      if (!isAbortError(error)) {
        this.store.appendLog(error instanceof Error ? error.message : String(error), 'error');
      }
    });
  }
}

function asPoint(args: unknown): { x?: number; y?: number; scale?: number } {
  const record = asRecord(args);
  return {
    x: typeof record.x === 'number' ? record.x : undefined,
    y: typeof record.y === 'number' ? record.y : undefined,
    scale: typeof record.scale === 'number' ? record.scale : undefined
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>;
  }
  return {};
}
