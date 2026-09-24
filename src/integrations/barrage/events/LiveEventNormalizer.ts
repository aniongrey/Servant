import { liveConfig, type LiveConfig } from '../config/live.config.ts';
import type { LiveEvent, LiveEventType, LiveGift, LivePlatform, LiveUser } from './LiveEvent';

export class LiveEventNormalizer {
  constructor(private readonly config: LiveConfig = liveConfig) {}

  normalize(rawEvent: unknown, now = Date.now()): LiveEvent | undefined {
    if (!isRecord(rawEvent)) return undefined;

    const platform = normalizePlatform(readString(rawEvent, ['platform', 'source', 'site', 'app']));
    const type = normalizeEventType(
      readString(rawEvent, ['type', 'event', 'cmd', 'messageType', 'msg_type'])
    );
    if (!type) return undefined;

    const content = readString(rawEvent, ['content', 'text', 'message', 'msg', 'danmaku']);
    const user = normalizeUser(rawEvent);
    const gift = normalizeGift(rawEvent);
    const timestamp = readNumber(rawEvent, ['timestamp', 'time', 'ts', 'createdAt']) ?? now;
    const priority = 20;
    const event: LiveEvent = {
      id:
        readString(rawEvent, ['id', 'eventId', 'msgId']) ??
        createLiveEventId(platform, type, timestamp, user?.id, content),
      platform,
      roomId: readString(rawEvent, ['roomId', 'room_id', 'room']),
      type,
      user,
      content,
      gift,
      timestamp,
      priority,
      expiresAt: timestamp + this.config.ttl.defaultMs,
      metadata: {}
    };

    if (event.type === 'danmaku' && !event.content) return undefined;
    if (event.type === 'gift' && !event.gift) return undefined;
    return event;
  }
}

function normalizePlatform(value: string | undefined): LivePlatform {
  const normalized = value?.toLowerCase() ?? '';
  if (normalized.includes('bilibili') || normalized.includes('bili')) return 'bilibili';
  if (normalized.includes('douyin') || normalized.includes('dy') || normalized.includes('抖音'))
    return 'douyin';
  return 'unknown';
}

function normalizeEventType(value: string | undefined): LiveEventType | undefined {
  const normalized = value?.toLowerCase() ?? '';
  if (
    ['danmaku', 'danmu', 'comment', 'chat', 'message'].some((token) => normalized.includes(token)) ||
    normalized.includes('弹幕')
  ) {
    return 'danmaku';
  }
  if (normalized.includes('gift') || normalized.includes('礼物')) return 'gift';
  if (normalized.includes('enter') || normalized.includes('member') || normalized.includes('进房'))
    return 'enter';
  if (normalized.includes('like') || normalized.includes('点赞')) return 'like';
  if (normalized.includes('follow') || normalized.includes('关注')) return 'follow';
  if (normalized.includes('system') || normalized.includes('sys')) return 'system';
  return undefined;
}

function normalizeUser(rawEvent: Record<string, unknown>): LiveUser | undefined {
  const rawUser = isRecord(rawEvent.user) ? rawEvent.user : rawEvent;
  const id = readString(rawUser, ['id', 'uid', 'userId', 'user_id', 'open_id']);
  const name = readString(rawUser, ['name', 'nickname', 'userName', 'uname', 'displayName']) ?? id;
  if (!id || !name) return undefined;
  return {
    id,
    name,
    level: readNumber(rawUser, ['level', 'userLevel']),
    fanLevel: readNumber(rawUser, ['fanLevel', 'fansLevel', 'fan_level']),
    isAdmin: readBoolean(rawUser, ['isAdmin', 'admin', 'is_admin']),
    isStreamer: readBoolean(rawUser, ['isStreamer', 'isAnchor', 'streamer', 'anchor'])
  };
}

function normalizeGift(rawEvent: Record<string, unknown>): LiveGift | undefined {
  const rawGift = isRecord(rawEvent.gift) ? rawEvent.gift : rawEvent;
  const name = readString(rawGift, ['giftName', 'gift_name', 'name']);
  if (!name) return undefined;
  return {
    name,
    count: readNumber(rawGift, ['count', 'num', 'giftCount']) ?? 1,
    value: readNumber(rawGift, ['value', 'price', 'coin', 'diamond'])
  };
}

export function createLiveEventId(
  platform: LivePlatform,
  type: LiveEventType,
  timestamp: number,
  userId = 'anonymous',
  content = ''
): string {
  const suffix = hashString(`${platform}:${type}:${timestamp}:${userId}:${content}`).toString(36);
  return `${platform}-${type}-${timestamp}-${suffix}`;
}

function readString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function readNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

function readBoolean(source: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hashString(value: string): number {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return Math.abs(hash);
}
