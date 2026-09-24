import { describe, expect, it } from 'vitest';
import { getMotionPhaseRange, normalizeMotionPhaseConfig } from './motionDebug';

describe('debug motion phase editing', () => {
  it('preserves valid cuts and covers the entire motion without gaps', () => {
    const config = normalizeMotionPhaseConfig({ enterEnd: 0.4, holdEnd: 1.6 }, 2);

    expect(getMotionPhaseRange(config, 'enter')).toEqual({ start: 0, end: 0.4 });
    expect(getMotionPhaseRange(config, 'hold')).toEqual({ start: 0.4, end: 1.6 });
    expect(getMotionPhaseRange(config, 'exit')).toEqual({ start: 1.6, end: 2 });
  });

  it('keeps every segment playable when edited cuts cross or exceed the duration', () => {
    const config = normalizeMotionPhaseConfig({ enterEnd: 20, holdEnd: -1 }, 2);

    for (const phase of ['enter', 'hold', 'exit'] as const) {
      const range = getMotionPhaseRange(config, phase);
      expect(range.start).toBeGreaterThanOrEqual(0);
      expect(range.end).toBeGreaterThan(range.start);
      expect(range.end).toBeLessThanOrEqual(2);
    }
  });

  it('uses finite defaults before motion duration metadata is available', () => {
    const config = normalizeMotionPhaseConfig(undefined, Number.NaN);

    expect(config.duration).toBe(1.2);
    expect(config.enterEnd).toBeCloseTo(0.4);
    expect(config.holdEnd).toBeCloseTo(0.8);
  });
});
