export type LivePlatform = 'bilibili' | 'douyin' | 'unknown';

export type LiveEventType = 'danmaku' | 'gift' | 'enter' | 'like' | 'follow' | 'system';

export interface LiveUser {
  id: string;
  name: string;
  level?: number;
  fanLevel?: number;
  isAdmin?: boolean;
  isStreamer?: boolean;
}

export interface LiveGift {
  name: string;
  count: number;
  value?: number;
}

export interface AggregatedDanmaku {
  content: string;
  count: number;
  uniqueUsers: number;
  firstTimestamp: number;
  lastTimestamp: number;
}

export interface LiveEventMetadata extends Record<string, unknown> {
  aggregation?: AggregatedDanmaku & { key: string };
  noAiResponse?: boolean;
  isSpam?: boolean;
  priorityReasons?: string[];
}

export interface LiveEvent {
  id: string;
  platform: LivePlatform;
  roomId?: string;
  type: LiveEventType;
  user?: LiveUser;
  content?: string;
  gift?: LiveGift;
  timestamp: number;
  priority: number;
  expiresAt: number;
  metadata?: LiveEventMetadata;
}

export interface LiveEventConsumer {
  handleLiveEvent(event: LiveEvent): Promise<void>;
}

export type QueueBand = 'high' | 'normal' | 'low';
