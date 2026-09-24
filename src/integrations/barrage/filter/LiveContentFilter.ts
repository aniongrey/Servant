import { liveConfig, type LiveConfig } from '../config/live.config.ts';
import type { LiveEvent } from '../events/LiveEvent';

export type FilterRuleAction = 'hide' | 'ignore_ai';

export interface FilterRule {
  id: string;
  type: 'keyword' | 'regex';
  value: string;
  action: FilterRuleAction;
  enabled: boolean;
}

export interface LiveFilterResult {
  action: 'allow' | 'drop';
  event?: LiveEvent;
  reasons: string[];
}

export class LiveContentFilter {
  private readonly userMessageTimes = new Map<string, number[]>();

  constructor(private readonly config: LiveConfig = liveConfig) {}

  apply(event: LiveEvent, now = Date.now()): LiveFilterResult {
    const reasons: string[] = [];
    let nextEvent = event;

    for (const rule of this.config.filter.rules) {
      if (!rule.enabled || !event.content) continue;
      if (!matchesRule(rule, event.content)) continue;
      reasons.push(`filter.${rule.id}`);
      if (rule.action === 'hide') return { action: 'drop', reasons };
      nextEvent = markNoAiResponse(nextEvent);
    }

    if (event.type === 'danmaku' && event.user && this.isSpam(event.user.id, now)) {
      reasons.push('filter.spam');
      nextEvent = {
        ...nextEvent,
        metadata: {
          ...nextEvent.metadata,
          isSpam: true
        }
      };
    }

    return { action: 'allow', event: nextEvent, reasons };
  }

  private isSpam(userId: string, now: number): boolean {
    const windowStart = now - this.config.filter.spamWindowMs;
    const times = (this.userMessageTimes.get(userId) ?? []).filter((time) => time >= windowStart);
    times.push(now);
    this.userMessageTimes.set(userId, times);
    return times.length > this.config.filter.spamMaxMessages;
  }
}

function matchesRule(rule: FilterRule, content: string): boolean {
  if (rule.type === 'keyword') return content.includes(rule.value);
  try {
    return new RegExp(rule.value, 'i').test(content);
  } catch {
    return false;
  }
}

function markNoAiResponse(event: LiveEvent): LiveEvent {
  return {
    ...event,
    metadata: {
      ...event.metadata,
      noAiResponse: true
    }
  };
}
