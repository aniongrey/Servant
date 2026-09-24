import { liveConfig, type LiveConfig } from '../config/live.config.ts';
import type { LiveEvent, LiveEventConsumer } from '../events/LiveEvent';
import { LiveEventQueue } from '../queue/LiveEventQueue';

export interface LiveControllerState {
  enabled: boolean;
  isSpeaking: boolean;
  lastResponseAt: number;
  currentEvent?: LiveEvent;
  lastRespondedUsers: Map<string, number>;
}

export interface LiveControllerStats {
  expired: number;
  responded: number;
}

export class LiveController {
  readonly state: LiveControllerState;
  readonly stats: LiveControllerStats = {
    expired: 0,
    responded: 0
  };

  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly queue: LiveEventQueue,
    private readonly consumer: LiveEventConsumer,
    private readonly config: LiveConfig = liveConfig
  ) {
    this.state = {
      enabled: config.enabled,
      isSpeaking: false,
      lastResponseAt: 0,
      lastRespondedUsers: new Map()
    };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.controller.tickIntervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  setEnabled(enabled: boolean): void {
    this.state.enabled = enabled;
  }

  onSpeechStart(): void {
    this.state.isSpeaking = true;
  }

  onSpeechEnd(now = Date.now()): void {
    this.state.isSpeaking = false;
    this.state.lastResponseAt = now;
    this.state.currentEvent = undefined;
  }

  async tick(now = Date.now()): Promise<void> {
    if (!this.state.enabled) return;
    this.stats.expired += this.queue.clearExpired(now);
    if (this.state.isSpeaking) return;

    const highEvent = this.queue.peekHigh(now);
    if (highEvent) {
      await this.processNextHigh(now);
      return;
    }

    if (!this.cooldownFinished(now)) return;

    const normalEvent = this.queue.peekNormal(now);
    if (normalEvent) {
      await this.processNextNormal(now);
    }
  }

  getDebugState(now = Date.now()) {
    return {
      controller: {
        enabled: this.state.enabled,
        isSpeaking: this.state.isSpeaking,
        currentEventId: this.state.currentEvent?.id,
        cooldownRemaining: this.getCooldownRemaining(now)
      },
      stats: { ...this.stats }
    };
  }

  private async processNextHigh(now: number): Promise<void> {
    const event = this.queue.nextHigh(now);
    if (event) await this.processEvent(event, now);
  }

  private async processNextNormal(now: number): Promise<void> {
    const event = this.queue.nextNormal(now);
    if (event) await this.processEvent(event, now);
  }

  private async processEvent(event: LiveEvent, now: number): Promise<void> {
    if (event.expiresAt <= now || !this.canRespond(event)) return;
    this.state.currentEvent = event;
    await this.consumer.handleLiveEvent(toConsumerEvent(event));
    this.stats.responded += 1;
    if (event.user) this.state.lastRespondedUsers.set(event.user.id, now);
    this.onSpeechEnd(now);
  }

  private canRespond(event: LiveEvent): boolean {
    return event.metadata?.noAiResponse !== true;
  }

  private cooldownFinished(now: number): boolean {
    return this.getCooldownRemaining(now) <= 0;
  }

  private getCooldownRemaining(now: number): number {
    return Math.max(0, this.state.lastResponseAt + this.config.controller.responseCooldownMs - now);
  }
}

function toConsumerEvent(event: LiveEvent): LiveEvent {
  return {
    id: event.id,
    platform: event.platform,
    roomId: event.roomId,
    type: event.type,
    user: event.user,
    content: event.content,
    gift: event.gift,
    timestamp: event.timestamp,
    priority: event.priority,
    expiresAt: event.expiresAt,
    metadata: event.metadata?.aggregation ? { aggregation: event.metadata.aggregation } : undefined
  };
}
