import { describe, expect, it } from 'vitest';
import {
  TYPEWRITER_MAX_MS_PER_CHAR,
  TYPEWRITER_MIN_MS_PER_CHAR,
  typewriterStepMs,
  typewriterTotalMs
} from './typewriterTiming';

describe('typewriter timing', () => {
  it('keeps the per-character pace inside its bounds whatever the hint says', () => {
    // 语速提示来自「预计语音时长」，估偏了也不能让打字机变成闪烁或蜗牛。
    expect(typewriterStepMs('一二三四五', 0, 1)).toBeGreaterThanOrEqual(TYPEWRITER_MIN_MS_PER_CHAR);
    expect(typewriterStepMs('一二三四五', 0, 60_000)).toBeLessThanOrEqual(TYPEWRITER_MAX_MS_PER_CHAR + 180);
  });

  it('spreads a spoken duration across the whole line', () => {
    // 30 个字、4 秒语音 ≈ 133ms/字，夹到 90ms 上限以内，这才是正常的台词量级。
    const text = '这是一句不长不短的台词用来验证时长能不能铺满整行';
    const total = typewriterTotalMs(text, 4000);
    const perCharacter = total / Array.from(text).length;
    expect(perCharacter).toBeGreaterThan(TYPEWRITER_MIN_MS_PER_CHAR);
    expect(perCharacter).toBeLessThanOrEqual(TYPEWRITER_MAX_MS_PER_CHAR);
  });

  it('adds a beat after punctuation and for the closing mark', () => {
    const withStop = typewriterStepMs('好。', 1);
    const withoutStop = typewriterStepMs('好a', 1);
    expect(withStop).toBeGreaterThan(withoutStop);
  });

  it('returns zero for empty text instead of a negative or NaN duration', () => {
    expect(typewriterTotalMs('', 1000)).toBe(0);
  });

  it('sums the per-character steps rather than multiplying a flat pace', () => {
    // 逐字 setTimeout 的真实语义：标点会让某一步更长，所以总和必须等于逐步相加。
    const text = '你好，世界！';
    const manual = Array.from(text).reduce((sum, _, index) => sum + typewriterStepMs(text, index, 2000), 0);
    expect(typewriterTotalMs(text, 2000)).toBe(manual);
  });
});
