import { describe, expect, it } from 'vitest';
import { avatarFitRanges, defaultAvatarFitConfig, normalizeAvatarFitConfig } from './AvatarFitConfig';

describe('AvatarFitConfig hand IK', () => {
  it('uses one global IK rule for every arm motion', () => {
    const config = normalizeAvatarFitConfig({
      handIk: {
        enabled: true,
        strength: 0.75,
        iterations: 6,
        margin: 0.04,
        torsoPushMode: 'front',
        frontPushMinHeight: 0.5
      }
    });

    expect(config.handIk).toEqual({
      enabled: true,
      strength: 0.75,
      iterations: 6,
      margin: 0.04,
      torsoPushMode: 'front',
      frontPushMinHeight: 0.5
    });
    expect('motionOverrides' in config.handIk).toBe(false);
  });

  it('keeps hand IK enabled by default', () => {
    expect(normalizeAvatarFitConfig(undefined).handIk.enabled).toBe(true);
    expect(defaultAvatarFitConfig.handIk.enabled).toBe(true);
  });

  it('covers the cocoa and VRM1 constraint sample reference sizes', () => {
    expect(avatarFitRanges.height).toEqual({ min: 0.585, max: 1.815, step: 0.005 });
    expect(avatarFitRanges.shoulderWidth.min).toBeLessThanOrEqual(0.078);
    expect(avatarFitRanges.armLength.min).toBeLessThanOrEqual(0.1792);
    expect(avatarFitRanges.armLength.max).toBeGreaterThanOrEqual(defaultAvatarFitConfig.armLength);
  });
});
