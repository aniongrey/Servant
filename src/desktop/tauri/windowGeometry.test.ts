import { describe, expect, it } from 'vitest';
import { parseWindowPosition, restoreVisiblePosition } from './windowGeometry';

describe('desktop window position', () => {
  const size = { width: 520, height: 760 };
  const main = { x: 0, y: 0, width: 1920, height: 1040 };
  const left = { x: -1920, y: 0, width: 1920, height: 1080 };
  it('restores a negative position on a connected secondary monitor', () => {
    const saved = parseWindowPosition('{"x":-1500,"y":100}');
    expect(restoreVisiblePosition(saved!, size, [main, left])).toEqual(saved);
  });
  it('moves an unplugged monitor position back onto the remaining work area', () => {
    expect(restoreVisiblePosition({ x: -1500, y: 900 }, size, [main])).toEqual({ x: 0, y: 280 });
  });
  it('keeps the toolbar reachable on a screen smaller than the window', () => {
    expect(
      restoreVisiblePosition({ x: 9999, y: 9999 }, size, [{ x: 0, y: 0, width: 400, height: 600 }])
    ).toEqual({ x: 0, y: 0 });
  });
  it('rejects corrupt or nonnumeric saved coordinates', () => {
    for (const value of [null, 'bad', '{}', '{"x":"1","y":2}', '{"x":1e999,"y":2}']) {
      expect(parseWindowPosition(value)).toBeNull();
    }
  });
});
