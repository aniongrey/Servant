import type { EventDefinition, RuntimeContext } from '../app/runtimeTypes';
import type { EventRunner, EventRunnerControllers } from './EventRunner';
import type { RuntimeStore } from '../app/state/RuntimeStore';
import { isAbortError } from '../app/utils/delay';

interface CurrentRun {
  runId: number;
  event: EventDefinition;
  context: RuntimeContext;
  abortController: AbortController;
}

interface QueuedRun {
  event: EventDefinition;
  context: RuntimeContext;
  resolve(): void;
}

export class EventDirector {
  private readonly events = new Map<string, EventDefinition>();
  private readonly playsToday = new Map<string, number>();
  private current?: CurrentRun;
  private lastRun?: Pick<CurrentRun, 'event' | 'context'>;
  private runSequence = 0;
  private readonly queue: QueuedRun[] = [];
  private drainingQueue = false;

  constructor(
    eventDefinitions: EventDefinition[],
    private readonly runner: EventRunner,
    private readonly controllers: EventRunnerControllers,
    private readonly store: RuntimeStore
  ) {
    for (const event of eventDefinitions) {
      this.events.set(event.id, event);
    }
  }

  listEvents(): EventDefinition[] {
    return [...this.events.values()];
  }

  async play(eventId: string, context: RuntimeContext, options: { force?: boolean } = {}): Promise<void> {
    const event = this.events.get(eventId);
    if (!event) {
      throw new Error(`Unknown event: ${eventId}`);
    }

    if (!options.force && !this.canStart(event)) {
      return;
    }

    if (this.current) {
      if (!this.shouldInterrupt(event)) {
        this.store.appendLog(`Ignored ${event.id}; ${this.current.event.id} is running`, 'warn');
        return;
      }
      this.interrupt();
    }

    await this.run(event, context);
  }

  /** FIFO execution for background events that must never interrupt the active event. */
  enqueue(event: EventDefinition, context: RuntimeContext): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push({ event, context, resolve });
      this.store.appendLog(`Queued ${event.id}`);
      void this.drainQueue();
    });
  }

  private async run(event: EventDefinition, context: RuntimeContext): Promise<void> {
    const runId = ++this.runSequence;
    const abortController = new AbortController();
    this.current = {
      runId,
      event,
      context,
      abortController
    };
    this.lastRun = { event, context };

    this.playsToday.set(event.id, (this.playsToday.get(event.id) ?? 0) + 1);
    this.store.patch({
      director: {
        ...this.store.getSnapshot().director,
        currentEvent: {
          id: event.id,
          title: event.title,
          priority: event.priority,
          runId
        },
        currentStep: 0,
        totalSteps: event.steps.length,
        cooldowns: {
          ...this.store.getSnapshot().director.cooldowns,
          [event.id]: Date.now() + event.cooldownMs
        }
      }
    });
    this.store.appendLog(`Started ${event.id}`);

    try {
      await this.runner.run(event, context, abortController.signal);
      this.store.appendLog(`Completed ${event.id}`);
    } catch (error: unknown) {
      if (isAbortError(error)) {
        this.store.appendLog(`Interrupted ${event.id}`, 'warn');
      } else {
        this.store.appendLog(error instanceof Error ? error.message : String(error), 'error');
      }
    } finally {
      if (this.current?.runId === runId) {
        this.current = undefined;
        this.store.patch({
          director: {
            ...this.store.getSnapshot().director,
            currentEvent: undefined,
            currentStep: 0,
            totalSteps: 0
          }
        });
      }
      void this.drainQueue();
    }
  }

  private async drainQueue(): Promise<void> {
    if (this.current || this.drainingQueue) return;
    this.drainingQueue = true;
    try {
      while (!this.current && this.queue.length > 0) {
        const next = this.queue.shift()!;
        await this.run(next.event, next.context);
        next.resolve();
      }
    } finally {
      this.drainingQueue = false;
      if (!this.current && this.queue.length > 0) void this.drainQueue();
    }
  }

  interrupt(): void {
    if (!this.current) {
      return;
    }

    this.current.abortController.abort();
    this.controllers.fx.stopAll();
    void this.controllers.action.stopAll(0);
    void this.controllers.body.stop(0);
  }

  skipStep(): boolean {
    const skipped = this.runner.skipCurrentStep();
    if (!skipped) {
      this.store.appendLog('No active step to skip', 'warn');
    }
    return skipped;
  }

  replayStep(): boolean {
    const replayed = this.runner.replayCurrentStep();
    if (!replayed) {
      this.store.appendLog('No active step to replay', 'warn');
    }
    return replayed;
  }

  replayLastEvent(): void {
    const target = this.current ?? this.lastRun;
    if (!target) {
      this.store.appendLog('No event to replay', 'warn');
      return;
    }

    void this.play(target.event.id, target.context, { force: true });
  }

  private canStart(event: EventDefinition): boolean {
    const now = Date.now();
    const cooldownUntil = this.store.getSnapshot().director.cooldowns[event.id] ?? 0;
    if (cooldownUntil > now) {
      this.store.appendLog(`${event.id} is cooling down`, 'warn');
      return false;
    }

    if (event.maxPerDay !== undefined && (this.playsToday.get(event.id) ?? 0) >= event.maxPerDay) {
      this.store.appendLog(`${event.id} hit maxPerDay`, 'warn');
      return false;
    }

    return true;
  }

  private shouldInterrupt(next: EventDefinition): boolean {
    if (!this.current) {
      return true;
    }

    switch (next.interruptPolicy) {
      case 'replace':
        return true;
      case 'replaceLowerPriority':
        return next.priority > this.current.event.priority;
      case 'ignore':
        return false;
    }
  }
}
