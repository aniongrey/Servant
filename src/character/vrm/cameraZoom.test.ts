import { describe, expect, it } from 'vitest';
import { CAMERA_ZOOM_MAX, CAMERA_ZOOM_MIN, DEFAULT_CAMERA_ZOOM, clampCameraZoom } from './cameraZoom';

describe('camera zoom bounds', () => {
  it('leaves a reachable zoom untouched, boundaries included', () => {
    expect(clampCameraZoom(1.4)).toBe(1.4);
    expect(clampCameraZoom(CAMERA_ZOOM_MIN)).toBe(CAMERA_ZOOM_MIN);
    expect(clampCameraZoom(CAMERA_ZOOM_MAX)).toBe(CAMERA_ZOOM_MAX);
  });

  it('pulls a stored value the wheel could never produce back into range', () => {
    expect(clampCameraZoom(40)).toBe(CAMERA_ZOOM_MAX);
    expect(clampCameraZoom(0)).toBe(CAMERA_ZOOM_MIN);
    expect(clampCameraZoom(-3)).toBe(CAMERA_ZOOM_MIN);
  });

  it('maps a value that is not a usable number to the default', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(clampCameraZoom(value)).toBe(DEFAULT_CAMERA_ZOOM);
    }
  });
});
