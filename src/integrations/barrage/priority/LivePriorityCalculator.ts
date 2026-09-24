import { liveConfig, type LiveConfig } from '../config/live.config.ts';
import type { LiveEvent } from '../events/LiveEvent';

export interface PriorityContext {
  lastRespondedUsers?: Map<string, number>;
  now?: number;
}

export class LivePriorityCalculator {
  constructor(private readonly config: LiveConfig = liveConfig) {}

  calculate(event: LiveEvent, context: PriorityContext = {}): LiveEvent {
    const reasons: string[] = [];
    let score = 20 + (event.priority < 20 ? event.priority - 20 : 0);
    score += collectScore(reasons, 'user', calculateUserScore(event));
    score += collectScore(reasons, 'event', this.calculateEventScore(event));
    score += collectScore(reasons, 'content', this.calculateContentScore(event));
    score += collectScore(reasons, 'aggregation', calculateAggregationScore(event));
    score += collectScore(reasons, 'penalty', this.calculatePenalty(event, context));

    return {
      ...event,
      priority: score,
      expiresAt: calculateExpiresAt(event, score, this.config),
      metadata: {
        ...event.metadata,
        priorityReasons: reasons
      }
    };
  }

  private calculateEventScore(event: LiveEvent): number {
    if (event.type === 'gift') {
      return (event.gift?.value ?? 0) >= this.config.highValueGiftValue ? 80 : 40;
    }
    if (event.type === 'follow') return 20;
    return 0;
  }

  private calculateContentScore(event: LiveEvent): number {
    const content = event.content ?? '';
    let score = 0;
    if (this.config.petNames.some((name) => content.includes(name))) score += 40;
    if (content.includes('@宠物')) score += 50;
    if (isQuestion(content)) score += 20;
    return score;
  }

  private calculatePenalty(event: LiveEvent, context: PriorityContext): number {
    let score = 0;
    const content = event.content?.trim() ?? '';
    if (this.config.filter.lowValueMessages.includes(content)) score -= 20;
    if (event.metadata?.isSpam) score -= 40;
    const userId = event.user?.id;
    const lastRespondedAt = userId ? context.lastRespondedUsers?.get(userId) : undefined;
    if (lastRespondedAt !== undefined) {
      score -= 30;
      if ((context.now ?? Date.now()) - lastRespondedAt <= 10000) score -= 20;
    }
    return score;
  }
}

function calculateUserScore(event: LiveEvent): number {
  let score = 0;
  if (event.user?.isStreamer) score += 100;
  if (event.user?.isAdmin) score += 80;
  if ((event.user?.level ?? 0) >= 10) score += 10;
  if ((event.user?.fanLevel ?? 0) > 0) score += 10;
  return score;
}

function calculateAggregationScore(event: LiveEvent): number {
  const uniqueUsers = event.metadata?.aggregation?.uniqueUsers ?? 0;
  let score = 0;
  if (uniqueUsers >= 5) score += 10;
  if (uniqueUsers >= 10) score += 20;
  if (uniqueUsers >= 30) score += 40;
  return score;
}

function calculateExpiresAt(event: LiveEvent, priority: number, config: LiveConfig): number {
  if (event.type === 'gift') return event.timestamp + config.ttl.giftMs;
  if (event.type === 'follow') return event.timestamp + config.ttl.followMs;
  if (event.type === 'danmaku' && isQuestion(event.content ?? ''))
    return event.timestamp + config.ttl.questionMs;
  if (event.type === 'danmaku' && priority >= config.queue.highThreshold)
    return event.timestamp + config.ttl.highDanmakuMs;
  if (event.type === 'danmaku') return event.timestamp + config.ttl.danmakuMs;
  return event.timestamp + config.ttl.defaultMs;
}

function collectScore(reasons: string[], label: string, score: number): number {
  if (score !== 0) reasons.push(`${label}(${score})`);
  return score;
}

export function isQuestion(content: string): boolean {
  return /[?？]|吗|嘛|呢|为什么|怎么|什么|谁|哪里/.test(content);
}
