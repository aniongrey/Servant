import { describe, expect, it } from 'vitest';
import {
  normalizeSchedulerToolInput,
  normalizeUnixMilliseconds,
  readRelativeDelay
} from './SchedulerToolInputNormalizer';

describe('SchedulerToolInputNormalizer', () => {
  it('recalculates explicit relative time from the local clock', () => {
    const normalized = normalizeSchedulerToolInput(
      {
        action: 'add',
        name: '喝水',
        schedule: { type: 'once', at: 1 },
        text: '喝水'
      },
      '10分钟后提醒我喝水',
      1_000_000
    );
    expect(normalized).toMatchObject({ schedule: { type: 'once', at: 1_600_000 } });
  });

  it('converts model-produced Unix seconds to milliseconds', () => {
    expect(normalizeUnixMilliseconds(1_788_950_000)).toBe(1_788_950_000_000);
    expect(normalizeUnixMilliseconds(1_788_950_000_000)).toBe(1_788_950_000_000);
  });

  it('recognizes common Chinese relative durations', () => {
    expect(readRelativeDelay('半小时后叫我')).toBe(30 * 60_000);
    expect(readRelativeDelay('十五分钟后提醒我')).toBe(15 * 60_000);
    expect(readRelativeDelay('两天后提醒我')).toBe(2 * 86_400_000);
  });

  it('keeps recurring schedules unchanged', () => {
    const input = {
      action: 'add' as const,
      name: '休息',
      schedule: { type: 'daily' as const, hour: 21, minute: 0 },
      text: '休息'
    };
    expect(normalizeSchedulerToolInput(input, '每天晚上九点提醒我休息', 1_000)).toEqual(input);
  });
});
