/**
 * 开舞台时的召唤排期。
 *
 * 舞台一开，名单上的角色**一个接一个**被召唤（`useCharacterEntryEffect.play`），
 * 而不是所有人一起出现。间隔刻意短于召唤动画本身（`CHARACTER_ENTRY_DURATION_MS`
 * 是 1250ms），这样看起来是依次登场的连锁，而不是等 1.25 秒才来下一个——五个人
 * 依次等满就是六秒，太慢了。
 */
export const STAGE_SUMMON_STAGGER_MS = 420;

export interface SummonStep {
  id: string;
  atMs: number;
}

/** 按名单次序排召唤时机：第 n 个在 `n * staggerMs` 毫秒后拿到召唤权。 */
export function summonSchedule(
  ids: readonly string[],
  staggerMs: number = STAGE_SUMMON_STAGGER_MS
): SummonStep[] {
  const step = Number.isFinite(staggerMs) ? Math.max(0, staggerMs) : 0;
  return ids.map((id, index) => ({ id, atMs: index * step }));
}
