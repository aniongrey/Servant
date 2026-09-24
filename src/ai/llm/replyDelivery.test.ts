import { describe, expect, it } from 'vitest';
import { COMPLETED_TURN_DRAIN_GAP_MS, getQueuedSegmentDelayMs, getReplyDelayMs } from './replyDelivery';

describe('reply delivery delay', () => {
  it('sends the first reply immediately and delays later replies by one second per ten characters', () => {
    expect(getReplyDelayMs('第一条不用等', 0)).toBe(0);
    expect(getReplyDelayMs('一二三四五', 1)).toBe(500);
    expect(getReplyDelayMs('一二三四五六', 2)).toBe(600);
    expect(getReplyDelayMs('一 二\n三', 1)).toBe(300);
  });
});

describe('queued segment delay', () => {
  it('keeps the typing rhythm while the turn is still streaming', () => {
    expect(getQueuedSegmentDelayMs('第一条不用等', 0, false)).toBe(0);
    expect(getQueuedSegmentDelayMs('一二三四五', 1, false)).toBe(500);
  });

  it('drains the remaining queue as a burst once turn-end proved the reply is complete', () => {
    expect(getQueuedSegmentDelayMs('一二三四五六七八九十', 1, true)).toBe(COMPLETED_TURN_DRAIN_GAP_MS);
    expect(getQueuedSegmentDelayMs('一二', 4, true)).toBe(COMPLETED_TURN_DRAIN_GAP_MS);
  });
});
