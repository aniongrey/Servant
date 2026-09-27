/**
 * Shared camera zoom normalization for the wheel handler and persisted values.
 */
/** What every stage starts at when nobody has stored anything. */
export const DEFAULT_CAMERA_ZOOM = 2;

/**
 * Storage is user-writable, so non-finite values still fall back safely.
 */
export function clampCameraZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_CAMERA_ZOOM;
  return zoom;
}
