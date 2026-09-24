import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESKTOP_PET_CAMERA_ZOOM_STORAGE_KEY } from '../../app/settings/storageKeys';
import { CAMERA_ZOOM_MAX, DEFAULT_CAMERA_ZOOM } from '../../character/vrm/cameraZoom';
import { loadPetCameraZoom, savePetCameraZoom } from './petCameraZoom';

afterEach(() => vi.unstubAllGlobals());

/** Stand-in for WebView2 storage; the suite runs without a DOM. */
function mockStorage(raw: string | null) {
  const values = new Map<string, string>();
  if (raw !== null) values.set(DESKTOP_PET_CAMERA_ZOOM_STORAGE_KEY, raw);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value)
  });
  return values;
}

describe('desktop pet zoom', () => {
  it('starts at the default when nothing was ever stored', () => {
    mockStorage(null);
    expect(loadPetCameraZoom()).toBe(DEFAULT_CAMERA_ZOOM);
  });

  it('resumes the zoom the user left the pet at', () => {
    mockStorage('1.75');
    expect(loadPetCameraZoom()).toBe(1.75);
  });

  it('round-trips a wheel zoom through storage', () => {
    const values = mockStorage(null);
    savePetCameraZoom(0.8);
    expect(values.get(DESKTOP_PET_CAMERA_ZOOM_STORAGE_KEY)).toBe('0.8');
    expect(loadPetCameraZoom()).toBe(0.8);
  });

  it('falls back to the default for corrupt or wrongly typed payloads', () => {
    for (const raw of ['not json', '"1.5"', '{}', 'null', 'true', '[1]']) {
      mockStorage(raw);
      expect(loadPetCameraZoom()).toBe(DEFAULT_CAMERA_ZOOM);
    }
  });

  it('bounds a hand-edited value before it can reach the camera', () => {
    mockStorage('99');
    expect(loadPetCameraZoom()).toBe(CAMERA_ZOOM_MAX);
  });

  it('never writes a value outside the wheel range', () => {
    const values = mockStorage(null);
    savePetCameraZoom(99);
    expect(values.get(DESKTOP_PET_CAMERA_ZOOM_STORAGE_KEY)).toBe(String(CAMERA_ZOOM_MAX));
  });
});
