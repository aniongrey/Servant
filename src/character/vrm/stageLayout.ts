/**
 * Pure geometry behind the shared stage's layout cache.
 *
 * Split out for the same reason the frame clock is: this is the part that has to be
 * right, and a mistake here puts every character in the wrong place — or fails to
 * skip one that is off screen — without breaking anything else. The tests pin the
 * two conventions that are easy to get backwards: boxes are canvas-relative, and
 * WebGL's viewport origin is the bottom-left while DOM rects start at the top-left.
 */

/** The subset of `DOMRect` the layout cache reads. */
export interface RectLike {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

/** Actor box in canvas CSS pixels, with `top` measured downward from the canvas top. */
export type CanvasBox = RectLike;

export function toCanvasBox(canvas: RectLike, viewport: RectLike): CanvasBox {
  return {
    left: viewport.left - canvas.left,
    top: viewport.top - canvas.top,
    right: viewport.right - canvas.left,
    bottom: viewport.bottom - canvas.top,
    width: viewport.width,
    height: viewport.height
  };
}

/**
 * `setViewport` measures up from the bottom-left, so an actor's vertical origin is
 * how far its bottom edge sits above the canvas bottom — not its `top`.
 */
export function actorViewportOrigin(box: CanvasBox, canvasHeight: number): number {
  return canvasHeight - box.bottom;
}

/**
 * Stacking order, where `data-layer` wins over the inline `z-index`. `||` rather
 * than `??` is deliberate: an empty attribute should fall through, and the string
 * `'0'` is truthy so layer 0 still reads as 0.
 */
export function readActorLayer(dataLayer: string | null, inlineZIndex: string): number {
  return Number(dataLayer || inlineZIndex || 0);
}

/** Nothing to draw when the box is empty or entirely outside the canvas. */
export function isActorVisible(box: CanvasBox, canvas: Pick<RectLike, 'width' | 'height'>): boolean {
  if (box.width <= 0 || box.height <= 0) return false;
  return box.right > 0 && box.left < canvas.width && box.bottom > 0 && box.top < canvas.height;
}
