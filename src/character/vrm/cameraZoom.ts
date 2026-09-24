/**
 * Bounds of the camera zoom shared by the wheel handler and the code that
 * remembers the desktop pet's value.
 *
 * These live outside `stageRendering.ts` on purpose: a restored zoom is only
 * meaningful if the wheel can reach it, so the writer and the reader must agree
 * on one range. Two copies would let a saved value sit outside what the wheel
 * can produce, and the first scroll would snap the model back.
 */
export const CAMERA_ZOOM_MIN = 0.5;
export const CAMERA_ZOOM_MAX = 2.5;
/** What every stage starts at when nobody has stored anything. */
export const DEFAULT_CAMERA_ZOOM = 1;

/**
 * Clamps `zoom` into the wheel's range, mapping anything non-finite to the
 * default. Storage is user-writable, so the value coming back from a previous
 * launch is untrusted input, not a number the renderer produced.
 */
export function clampCameraZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_CAMERA_ZOOM;
  return Math.min(CAMERA_ZOOM_MAX, Math.max(CAMERA_ZOOM_MIN, zoom));
}
