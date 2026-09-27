import { describe, expect, it } from 'vitest';
import { actorViewportOrigin, isActorVisible, readActorLayer, toCanvasBox, type RectLike } from './stageLayout';

function rect(left: number, top: number, width: number, height: number): RectLike {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

describe('canvas layout', () => {
  it('moves a viewport box into canvas coordinates', () => {
    const canvas = rect(-100, 40, 800, 600);
    const box = toCanvasBox(canvas, rect(-100, 40, 200, 300));

    expect(box).toEqual({ left: 0, top: 0, right: 200, bottom: 300, width: 200, height: 300 });
  });

  it('measures the draw origin up from the canvas bottom, not down from the top', () => {
    const canvas = rect(0, 0, 800, 600);
    const box = toCanvasBox(canvas, rect(0, 100, 200, 300));

    // The actor's top is at 100, its bottom at 400, so its WebGL origin is 200.
    expect(box.top).toBe(100);
    expect(actorViewportOrigin(box, canvas.height)).toBe(200);
  });

  it('reports an actor that is partly off screen as visible, and one fully outside as not', () => {
    const canvas = rect(0, 0, 800, 600);
    expect(isActorVisible(toCanvasBox(canvas, rect(-50, 10, 200, 200)), canvas)).toBe(true);
    expect(isActorVisible(toCanvasBox(canvas, rect(850, 10, 200, 200)), canvas)).toBe(false);
    expect(isActorVisible(toCanvasBox(canvas, rect(10, -200, 200, 200)), canvas)).toBe(false);
    expect(isActorVisible(toCanvasBox(canvas, rect(10, 10, 0, 200)), canvas)).toBe(false);
  });

  it('prefers data-layer over the inline z-index, and keeps layer 0 addressable', () => {
    expect(readActorLayer('3', '9')).toBe(3);
    expect(readActorLayer('0', '9')).toBe(0);
    expect(readActorLayer(null, '9')).toBe(9);
    expect(readActorLayer('', '')).toBe(0);
  });
});
