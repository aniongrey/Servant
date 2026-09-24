import { liveConfig, type LiveConfig } from '../config/live.config.ts';
import type { LiveEvent, QueueBand } from '../events/LiveEvent';

export interface LiveEventQueueSnapshot {
  high: number;
  normal: number;
  low: number;
}

export class LiveEventQueue {
  readonly high: LiveEvent[] = [];
  readonly normal: LiveEvent[] = [];
  readonly low: LiveEvent[] = [];

  constructor(private readonly config: LiveConfig = liveConfig) {}

  add(event: LiveEvent): QueueBand {
    const band = this.route(event);
    const target = this.getBandQueue(band);
    this.removeEquivalentFromAllBands(event);
    target.push(event);
    trimQueue(target, this.getMaxSize(band));
    return band;
  }

  peekHigh(now = Date.now()): LiveEvent | undefined {
    return this.peek(this.high, now);
  }

  peekNormal(now = Date.now()): LiveEvent | undefined {
    return this.peek(this.normal, now);
  }

  nextHigh(now = Date.now()): LiveEvent | undefined {
    return this.next(this.high, now);
  }

  nextNormal(now = Date.now()): LiveEvent | undefined {
    return this.next(this.normal, now);
  }

  clearExpired(now = Date.now()): number {
    return (
      this.clearExpiredFrom(this.high, now) +
      this.clearExpiredFrom(this.normal, now) +
      this.clearExpiredFrom(this.low, now)
    );
  }

  getSnapshot(): LiveEventQueueSnapshot {
    return {
      high: this.high.length,
      normal: this.normal.length,
      low: this.low.length
    };
  }

  route(event: LiveEvent): QueueBand {
    if (event.priority >= this.config.queue.highThreshold) return 'high';
    if (event.priority >= this.config.queue.normalThreshold) return 'normal';
    return 'low';
  }

  private peek(queue: LiveEvent[], now: number): LiveEvent | undefined {
    this.clearExpiredFrom(queue, now);
    return queue[0];
  }

  private next(queue: LiveEvent[], now: number): LiveEvent | undefined {
    this.clearExpiredFrom(queue, now);
    return queue.shift();
  }

  private clearExpiredFrom(queue: LiveEvent[], now: number): number {
    let removed = 0;
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (queue[index].expiresAt <= now) {
        queue.splice(index, 1);
        removed += 1;
      }
    }
    return removed;
  }

  private getBandQueue(band: QueueBand): LiveEvent[] {
    if (band === 'high') return this.high;
    if (band === 'normal') return this.normal;
    return this.low;
  }

  private getMaxSize(band: QueueBand): number {
    if (band === 'high') return this.config.queue.maxHighSize;
    if (band === 'normal') return this.config.queue.maxNormalSize;
    return this.config.queue.maxLowSize;
  }

  private removeEquivalentFromAllBands(event: LiveEvent): void {
    for (const queue of [this.high, this.normal, this.low]) {
      const existingIndex = findEquivalentIndex(queue, event);
      if (existingIndex >= 0) queue.splice(existingIndex, 1);
    }
  }
}

function findEquivalentIndex(queue: LiveEvent[], event: LiveEvent): number {
  const aggregationKey = event.metadata?.aggregation?.key;
  if (aggregationKey) {
    return queue.findIndex((queued) => queued.metadata?.aggregation?.key === aggregationKey);
  }
  return queue.findIndex((queued) => queued.id === event.id);
}

function trimQueue(queue: LiveEvent[], maxSize: number): void {
  while (queue.length > maxSize) queue.shift();
}
