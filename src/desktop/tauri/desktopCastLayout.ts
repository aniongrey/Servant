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

/**
 * 舞台中央的「模型中心点」（百分比，相对整窗）。
 *
 * 单角色时自动摆位的结果就是它。
 *
 * **注意 `pose.x` 存的是模型中心，不是列左边缘。** 每个角色的列恒为整屏宽
 * （不再按人数均分），而模型画在列的中心，所以「列左边缘」和「人物站哪儿」是两个
 * 不同的数，混用会让模型整只飞出屏幕（单角色时尤其明显：`left = 50%` + 宽 100%
 * 会把模型中心推到 100%，正好贴着右边缘看不见）。
 */
export const stageCenterX = (area: ScreenRect): number => area.x + area.width / 2;

/** 列左边缘 = 中心 - 半宽。列恒为整屏宽，所以半宽恒为 `area.width / 2`。 */
export const castColumnLeft = (centerX: number, area: ScreenRect): number => centerX - area.width / 2;

/**
 * 第 `index` 号角色在自动摆位里被安排到第几格（0 起）。
 *
 * 主角色恒占正中间那一格，其余按名单次序补空——所以返回的是「位置 ← 序号」，
 * 不是反过来的。例：3 人 `mainIndex=0` 得 `[1, 0, 2]`，即主角色站第 1 格（中间）、
 * 原来的 0 号被让到第 0 格、2 号顺延到第 2 格。`mainIndex < 0` 时不做居中，直接
 * 按次序 `[0, 1, 2, …]`。
 */
export function castSlot(index: number, count: number, mainIndex: number): number {
  const order = Array.from({ length: count }, (_, slot) => slot);
  if (mainIndex >= 0 && mainIndex < count) {
    order.splice(mainIndex, 1);
    order.splice(Math.floor(count / 2), 0, mainIndex);
  }
  return order.indexOf(index);
}

/**
 * 自动摆位：把舞台横向均分成 `count` 格，主角色站正中间，其余按名单次序补空。
 * 返回第 `index` 个角色的**模型中心** x（百分比，相对整窗）。
 *
 * `count <= 0` 时退化为单角色（正中），不产出 NaN。
 */
export function autoCastCenterX(
  index: number,
  count: number,
  mainIndex: number,
  area: ScreenRect
): number {
  const safe = Math.max(1, count);
  return area.x + (castSlot(index, safe, mainIndex) + 0.5) * area.width / safe;
}
