import { describe, expect, it } from 'vitest';
import { calculateNextRun, scheduleToCron } from './SchedulerTime';

describe('SchedulerTime', () => {
  it('calculates daily time from the local calendar instead of adding 24 hours', () => {
    const after = new Date(2026, 8, 9, 9, 30).getTime();
    expect(calculateNextRun({ type: 'daily', hour: 8, minute: 15 }, after)).toBe(
      new Date(2026, 8, 10, 8, 15).getTime()
    );
  });

  it('creates six-field daily and weekly cron expressions', () => {
    expect(scheduleToCron({ type: 'daily', hour: 9, minute: 30 })).toBe('0 30 9 * * *');
    expect(scheduleToCron({ type: 'weekly', weekdays: [5, 1, 3], hour: 20, minute: 0 })).toBe(
      '0 0 20 * * 1,3,5'
    );
  });
});
