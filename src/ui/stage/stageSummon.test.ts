import { describe, expect, it } from 'vitest';
import { STAGE_SUMMON_STAGGER_MS, summonSchedule } from './stageSummon';

describe('stage summon schedule', () => {
  it('summons the cast one after another, in roster order', () => {
    expect(summonSchedule(['a', 'b', 'c'], 400)).toEqual([
      { id: 'a', atMs: 0 },
      { id: 'b', atMs: 400 },
      { id: 'c', atMs: 800 }
    ]);
  });

  it('is short enough to cascade rather than queue up for seconds', () => {
    // 五个人依次等满一整个召唤动画（1250ms）要六秒多——那是排队，不是连锁登场。
    const five = summonSchedule(['a', 'b', 'c', 'd', 'e']);
    expect(five.at(-1)?.atMs).toBe(4 * STAGE_SUMMON_STAGGER_MS);
    expect(five.at(-1)?.atMs).toBeLessThan(1250 * 2);
  });

  it('degrades safely on odd input', () => {
    expect(summonSchedule([], 400)).toEqual([]);
    // 负数 / NaN 都不能让排期倒着走或变成 NaN。
    expect(summonSchedule(['a', 'b'], -100)).toEqual([{ id: 'a', atMs: 0 }, { id: 'b', atMs: 0 }]);
    expect(summonSchedule(['a', 'b'], Number.NaN)).toEqual([{ id: 'a', atMs: 0 }, { id: 'b', atMs: 0 }]);
  });
});
