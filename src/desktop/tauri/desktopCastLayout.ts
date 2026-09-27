import type { ScreenRect } from './windowGeometry';

/** Percentages relative to the all-monitor window; y is measured from the bottom. */
export const FULL_STAGE: ScreenRect = { x: 0, y: 0, width: 100, height: 100 };

export function screenStageArea(screen: ScreenRect, monitors: ScreenRect[]): ScreenRect {
  if (!monitors.length) return FULL_STAGE;
  const left = Math.min(...monitors.map((monitor) => monitor.x));
  const top = Math.min(...monitors.map((monitor) => monitor.y));
  const right = Math.max(...monitors.map((monitor) => monitor.x + monitor.width));
  const bottom = Math.max(...monitors.map((monitor) => monitor.y + monitor.height));
  return {
    x: (screen.x - left) / (right - left) * 100,
    y: (bottom - screen.y - screen.height) / (bottom - top) * 100,
    width: screen.width / (right - left) * 100,
    height: screen.height / (bottom - top) * 100
  };
}

export function castSlot(index: number, count: number, mainIndex: number): number {
  const order = Array.from({ length: count }, (_, slot) => slot);
  if (mainIndex >= 0 && mainIndex < count) {
    order.splice(mainIndex, 1);
    order.splice(Math.floor(count / 2), 0, mainIndex);
  }
  return order.indexOf(index);
}
