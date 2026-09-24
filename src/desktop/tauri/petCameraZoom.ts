import { readStoredJson, writeStoredJson } from '../../app/settings/browserStorage';
import { DESKTOP_PET_CAMERA_ZOOM_STORAGE_KEY } from '../../app/settings/storageKeys';
import { clampCameraZoom, DEFAULT_CAMERA_ZOOM } from '../../character/vrm/cameraZoom';

/**
 * The desktop pet's wheel zoom, remembered across launches.
 *
 * Deliberately scoped to the pet window. The very same `VrmStage` renders the
 * chat and settings windows, where a magnification dialled in on the desktop
 * companion would read as damage rather than as a preference — so those stages
 * simply keep the default.
 *
 * Storage is shared with the settings window (same origin, `storage` events
 * already drive the other preferences), which is what makes a future "reset the
 * pet zoom" control in the settings page a one-liner rather than a new channel.
 */
export function loadPetCameraZoom(): number {
  const stored = readStoredJson(DESKTOP_PET_CAMERA_ZOOM_STORAGE_KEY);
  return typeof stored === 'number' ? clampCameraZoom(stored) : DEFAULT_CAMERA_ZOOM;
}

export function savePetCameraZoom(zoom: number): void {
  writeStoredJson(DESKTOP_PET_CAMERA_ZOOM_STORAGE_KEY, clampCameraZoom(zoom));
}
