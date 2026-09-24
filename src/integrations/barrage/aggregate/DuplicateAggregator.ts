import { liveConfig, type LiveConfig } from '../config/live.config.ts';
import type { LiveEvent } from '../events/LiveEvent';

interface DuplicateGroup {
  key: string;
  content: string;
  count: number;
  userIds: Set<string>;
  firstTimestamp: number;
  lastTimestamp: number;
  event: LiveEvent;
}

export class DuplicateAggregator {
  private readonly groups = new Map<string, DuplicateGroup>();

  constructor(private readonly config: LiveConfig = liveConfig) {}

  apply(event: LiveEvent, now = Date.now()): LiveEvent {
    this.prune(now);
    if (event.type !== 'danmaku' || !event.content) return event;

    const key = normalizeDuplicateKey(event.content);
    const existing = this.groups.get(key);
    const userId = event.user?.id ?? `anonymous:${event.id}`;
    if (!existing || now - existing.firstTimestamp > this.config.aggregation.windowMs) {
      const group: DuplicateGroup = {
        key,
        content: event.content,
        count: 1,
        userIds: new Set([userId]),
        firstTimestamp: event.timestamp,
        lastTimestamp: event.timestamp,
        event
      };
      this.groups.set(key, group);
      return withAggregation(event, group);
    }

    existing.count += 1;
    existing.userIds.add(userId);
    existing.lastTimestamp = event.timestamp;
    existing.event = {
      ...existing.event,
      id: existing.event.id,
      timestamp: existing.firstTimestamp,
      expiresAt: Math.max(existing.event.expiresAt, event.expiresAt),
      metadata: {
        ...existing.event.metadata,
        ...event.metadata
      }
    };
    return withAggregation(existing.event, existing);
  }

  private prune(now: number): void {
    for (const [key, group] of this.groups) {
      if (now - group.firstTimestamp > this.config.aggregation.windowMs) {
        this.groups.delete(key);
      }
    }
  }
}

export function normalizeDuplicateKey(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, ' ');
}

function withAggregation(event: LiveEvent, group: DuplicateGroup): LiveEvent {
  return {
    ...event,
    content: group.content,
    metadata: {
      ...event.metadata,
      aggregation: {
        key: group.key,
        content: group.content,
        count: group.count,
        uniqueUsers: group.userIds.size,
        firstTimestamp: group.firstTimestamp,
        lastTimestamp: group.lastTimestamp
      }
    }
  };
}
