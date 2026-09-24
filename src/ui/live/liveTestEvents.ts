import type { LiveEventType, LivePlatform } from '../../integrations/barrage/events/LiveEvent';
import type { LiveSystemProcessResult } from '../../integrations/barrage/LiveSystem';
export interface ComposerState {
  platform: LivePlatform;
  type: LiveEventType;
  userId: string;
  userName: string;
  content: string;
  giftName: string;
  giftValue: string;
  isStreamer: boolean;
  isAdmin: boolean;
}

export const initialComposer: ComposerState = {
  platform: 'bilibili',
  type: 'danmaku',
  userId: 'viewer-01',
  userName: '观众 01',
  content: '白白你喜欢主播吗？',
  giftName: '小花花',
  giftValue: '10',
  isStreamer: false,
  isAdmin: false
};

export function createRawEvent(state: ComposerState): Record<string, unknown> {
  const timestamp = Date.now();
  const raw: Record<string, unknown> = {
    id: `manual-${timestamp}-${Math.random().toString(36).slice(2, 7)}`,
    platform: state.platform,
    type: state.type === 'danmaku' ? 'DANMU_MSG' : state.type,
    user: {
      id: state.userId,
      name: state.userName,
      isStreamer: state.isStreamer,
      isAdmin: state.isAdmin
    },
    timestamp
  };
  if (state.type === 'gift') {
    raw.gift = { name: state.giftName, count: 1, value: Number(state.giftValue) || 0 };
  } else {
    raw.content = state.content;
  }
  return raw;
}

export function runScenario(
  name: 'low' | 'question' | 'duplicate' | 'gift',
  ingest: (raw: unknown) => LiveSystemProcessResult
) {
  const now = Date.now();
  if (name === 'low') {
    for (let index = 0; index < 35; index += 1)
      ingest(rawDanmaku(`low-${index}`, `路人 ${index + 1}`, index % 2 ? '哈哈' : '666', now + index));
    return;
  }
  if (name === 'question') {
    ingest(rawDanmaku('question-user', '提问观众', '白白你喜欢主播吗？', now));
    return;
  }
  if (name === 'duplicate') {
    for (let index = 0; index < 30; index += 1)
      ingest(rawDanmaku(`behind-${index}`, `提醒观众 ${index + 1}`, '主播后面！', now + index));
    return;
  }
  ingest({
    platform: 'bilibili',
    type: 'gift',
    user: { id: 'gift-user', name: '送礼观众' },
    gift: { name: '醒目礼物', count: 1, value: 200 },
    timestamp: now
  });
}

function rawDanmaku(id: string, name: string, content: string, timestamp: number) {
  return { platform: 'bilibili', type: 'DANMU_MSG', user: { id, name }, content, timestamp };
}
