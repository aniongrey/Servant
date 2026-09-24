import type { LiveEvent, LiveEventType } from '../../integrations/barrage/events/LiveEvent';
import type { BarrageGrabStatus } from '../../integrations/barrage/adapters/BarrageGrabAdapter';
import type { LiveSystemProcessResult } from '../../integrations/barrage/LiveSystem';
import type { ActivityEntry } from './liveTestHarness';
export const categoryLabels: Record<ActivityEntry['category'], string> = {
  LIVE_INPUT: '输入',
  LIVE_RAW: '原始',
  LIVE_FILTER: '过滤',
  LIVE_PRIORITY: '优先级',
  LIVE_QUEUE: '入队',
  LIVE_RESPONSE: '响应',
  LIVE_ERROR: '错误'
};

export function formatProcessResult(result: LiveSystemProcessResult): string {
  if (result.status === 'queued') return `${describeEvent(result.event)} -> ${result.band?.toUpperCase()}`;
  if (result.status === 'ignored_ai') return `${describeEvent(result.event)} -> 不触发 AI`;
  return `${result.status.toUpperCase()}: ${result.reason ?? '未识别事件'}`;
}

export function describeEvent(event?: LiveEvent): string {
  if (!event) return '未知事件';
  const body = event.content ?? event.gift?.name ?? formatEventType(event.type);
  return `${event.user?.name ?? '系统'}: ${body}`;
}

export function formatEventType(type: LiveEventType): string {
  return { danmaku: '弹幕', gift: '礼物', enter: '进房', like: '点赞', follow: '关注', system: '系统' }[type];
}

export function formatSocketStatus(status: BarrageGrabStatus): string {
  return { connected: '已连接', connecting: '连接中', disconnected: '未连接' }[status];
}

export function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(timestamp);
}

export function formatExpiry(expiresAt: number): string {
  const remaining = Math.max(0, expiresAt - Date.now());
  if (remaining < 60 * 60 * 1000) return `${Math.ceil(remaining / 60000)} 分钟`;
  return `${Math.ceil(remaining / 3600000)} 小时`;
}
