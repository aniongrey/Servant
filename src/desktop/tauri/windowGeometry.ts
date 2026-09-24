export interface Point {
  x: number;
  y: number;
}
export interface ScreenRect extends Point {
  width: number;
  height: number;
}

export function parseWindowPosition(value: string | null): Point | null {
  try {
    const point = JSON.parse(value ?? 'null');
    return point && Number.isFinite(point.x) && Number.isFinite(point.y)
      ? { x: Math.round(point.x), y: Math.round(point.y) }
      : null;
  } catch {
    return null;
  }
}

// Keep the toolbar reachable after unplugging a monitor or changing display scale.
export function restoreVisiblePosition(
  point: Point,
  size: { width: number; height: number },
  screens: ScreenRect[]
): Point {
  const screen =
    screens.find(
      (screen) =>
        point.x >= screen.x &&
        point.y >= screen.y &&
        point.x + size.width <= screen.x + screen.width &&
        point.y + size.height <= screen.y + screen.height
    ) ??
    screens.find(
      (screen) =>
        point.x < screen.x + screen.width &&
        point.x + size.width > screen.x &&
        point.y < screen.y + screen.height &&
        point.y + size.height > screen.y
    ) ??
    screens[0];
  if (!screen) return point;
  return {
    x: Math.max(screen.x, Math.min(point.x, screen.x + Math.max(0, screen.width - size.width))),
    y: Math.max(screen.y, Math.min(point.y, screen.y + Math.max(0, screen.height - size.height)))
  };
}
