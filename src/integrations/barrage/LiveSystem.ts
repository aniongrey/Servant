import { DuplicateAggregator } from './aggregate/DuplicateAggregator';
import { BlacklistManager } from './blacklist/BlacklistManager';
import { liveConfig, type LiveConfig } from './config/live.config.ts';
import { LiveController } from './controller/LiveController';
import type { LiveEvent, LiveEventConsumer, QueueBand } from './events/LiveEvent';
import { LiveEventNormalizer } from './events/LiveEventNormalizer';
import { LiveContentFilter } from './filter/LiveContentFilter';
import type { LiveLogger } from './logger/LiveLogger';
import { silentLiveLogger } from './logger/LiveLogger';
import { LivePriorityCalculator } from './priority/LivePriorityCalculator';
import { LiveEventQueue } from './queue/LiveEventQueue';

export interface LiveSystemStats {
  received: number;
  filtered: number;
  expired: number;
  responded: number;
  queued: number;
}

export interface LiveSystemProcessResult {
  status: 'queued' | 'dropped' | 'ignored_ai' | 'unknown';
  event?: LiveEvent;
  band?: QueueBand;
  reason?: string;
}

export class LiveSystem {
  readonly normalizer: LiveEventNormalizer;
  readonly blacklist: BlacklistManager;
  readonly filter: LiveContentFilter;
  readonly aggregator: DuplicateAggregator;
  readonly priority: LivePriorityCalculator;
  readonly queue: LiveEventQueue;
  readonly controller: LiveController;
  readonly stats: LiveSystemStats = {
    received: 0,
    filtered: 0,
    expired: 0,
    responded: 0,
    queued: 0
  };

  constructor(
    consumer: LiveEventConsumer,
    config: LiveConfig = liveConfig,
    private readonly logger: LiveLogger = silentLiveLogger,
    blacklist = new BlacklistManager()
  ) {
    this.normalizer = new LiveEventNormalizer(config);
    this.blacklist = blacklist;
    this.filter = new LiveContentFilter(config);
    this.aggregator = new DuplicateAggregator(config);
    this.priority = new LivePriorityCalculator(config);
    this.queue = new LiveEventQueue(config);
    this.controller = new LiveController(this.queue, consumer, config);
  }

  async initialize(): Promise<void> {
    await this.blacklist.load();
  }

  ingestRaw(rawEvent: unknown, now = Date.now()): LiveSystemProcessResult {
    this.stats.received += 1;
    this.logger.log('LIVE_RAW', 'received', rawEvent);

    const normalized = this.normalizer.normalize(rawEvent, now);
    if (!normalized) return { status: 'unknown', reason: 'normalizer.unknown' };

    const blacklisted = this.blacklist.apply(normalized);
    if (blacklisted.action === 'drop' || !blacklisted.event) {
      this.stats.filtered += 1;
      this.logger.log('LIVE_FILTER', blacklisted.reason ?? 'blacklist.drop', normalized);
      return { status: 'dropped', reason: blacklisted.reason };
    }

    const filtered = this.filter.apply(blacklisted.event, now);
    if (filtered.action === 'drop' || !filtered.event) {
      this.stats.filtered += 1;
      this.logger.log('LIVE_FILTER', filtered.reasons.join(', '), blacklisted.event);
      return { status: 'dropped', reason: filtered.reasons.join(', ') };
    }

    const aggregated = this.aggregator.apply(filtered.event, now);
    const prioritized = this.priority.calculate(aggregated, {
      lastRespondedUsers: this.controller.state.lastRespondedUsers,
      now
    });
    this.logger.log(
      'LIVE_PRIORITY',
      prioritized.metadata?.priorityReasons?.join(' + ') ?? 'base(20)',
      prioritized
    );

    if (prioritized.metadata?.noAiResponse) {
      this.logger.log('LIVE_FILTER', 'ignore_ai', prioritized);
      return { status: 'ignored_ai', event: prioritized };
    }

    const band = this.queue.add(prioritized);
    this.stats.queued += 1;
    this.logger.log('LIVE_QUEUE', band, prioritized);
    return { status: 'queued', event: prioritized, band };
  }

  async tick(now = Date.now()): Promise<void> {
    await this.controller.tick(now);
    this.stats.expired = this.controller.stats.expired;
    this.stats.responded = this.controller.stats.responded;
  }

  getDebugState(now = Date.now()) {
    const controllerDebug = this.controller.getDebugState(now);
    return {
      connected: false,
      platform: 'unknown',
      queue: this.queue.getSnapshot(),
      stats: {
        ...this.stats,
        expired: this.controller.stats.expired,
        responded: this.controller.stats.responded
      },
      controller: controllerDebug.controller
    };
  }
}
