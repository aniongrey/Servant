import { describe, expect, it } from 'vitest';
import { DEFAULT_CAMERA_ZOOM, clampCameraZoom } from './cameraZoom';

describe('camera zoom normalization', () => {
  it('leaves finite zoom values untouched', () => {
    expect(clampCameraZoom(1.4)).toBe(1.4);
    expect(clampCameraZoom(40)).toBe(40);
    expect(clampCameraZoom(-3)).toBe(-3);
  });

  it('maps a value that is not a usable number to the default', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(clampCameraZoom(value)).toBe(DEFAULT_CAMERA_ZOOM);
    }
  });
});
