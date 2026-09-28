import { expect, it } from 'vitest';
import { autoCastCenterX, castColumnLeft, castSlot, screenStageArea, stageCenterX } from './desktopCastLayout';

it.each([0, 1])('maps the selected screen onto the monitor union with monitor %i', (mainIndex) => {
  // Different monitor sizes and negative origins model a mixed-DPI, offset desktop.
  const monitors = [
    { x: -1920, y: 0, width: 1920, height: 1080 },
    { x: 0, y: -360, width: 2560, height: 1440 }
  ];
  const work = { ...monitors[mainIndex], height: monitors[mainIndex].height - 40 };
  const area = screenStageArea(work, monitors);
  expect(1080 - area.y / 100 * 1440).toBeCloseTo(work.y + work.height);
  expect(area.height / 100 * 1440).toBeCloseTo(work.height);
  expect(area.width / 100 * 4480).toBeCloseTo(work.width);
});

const FULL = { x: 0, y: 0, width: 100, height: 100 };

it('summons everyone onto the middle of the stage', () => {
  expect(stageCenterX(FULL)).toBe(50);
  // 单角色最要紧的一条：列是整屏宽，`left` 必须回到 0。若把「中心 50」直接当 `left` 用，
  // 列就变成 50%~150%，模型中心被推到 100% —— 正好贴着右边缘，看起来就是「模型不显示」。
  expect(castColumnLeft(stageCenterX(FULL), FULL)).toBe(0);
  // 舞台只占多显示器并集的一部分时，中心跟着 area 走，不是永远 50。
  const area = { x: -50, y: 0, width: 50, height: 100 };
  expect(stageCenterX(area)).toBe(-25);
  expect(castColumnLeft(stageCenterX(area), area)).toBe(-50);
});

it('keeps the model centered on its pose after a drag', () => {
  // `pose.x` 存的是模型中心：拖到 80% 时列左边缘是 30%，模型中心仍是 80%。
  expect(castColumnLeft(80, FULL)).toBe(30);
  expect(castColumnLeft(20, FULL)).toBe(-30);
  // 中心可以拖出屏幕（列随之偏出去），但中心点本身不变。
  expect(castColumnLeft(-20, FULL)).toBe(-70);
  expect(castColumnLeft(120, FULL)).toBe(70);
});

it('auto-arranges the cast with the main character in the middle', () => {
  // `castSlot` 的语义是「位置 ← 序号」：主角色占正中间那一格，其余按名单次序补空。
  expect([0, 1, 2].map((index) => castSlot(index, 3, 0))).toEqual([1, 0, 2]);
  expect([0, 1, 2].map((index) => castSlot(index, 3, 1))).toEqual([0, 1, 2]);
  expect([0, 1, 2].map((index) => castSlot(index, 3, 2))).toEqual([0, 2, 1]);
  // 无主角色（mainIndex < 0）时直接按次序。
  expect([0, 1, 2].map((index) => castSlot(index, 3, -1))).toEqual([0, 1, 2]);

  // 3 人、主角色是 0 号：主角色中心 50（正中），0 号让到第 0 格（16.67），2 号第 2 格（83.33）。
  expect(autoCastCenterX(0, 3, 0, FULL)).toBeCloseTo(50, 5);
  expect(autoCastCenterX(1, 3, 0, FULL)).toBeCloseTo(16.6667, 4);
  expect(autoCastCenterX(2, 3, 0, FULL)).toBeCloseTo(83.3333, 4);

  // 2 人、主角色 0 号：主角色占第 1 格（75），另一个补第 0 格（25）。
  // `castSlot` 用 `floor(count/2)` 取中间格，偶数时落在右半边的那个格子。
  expect(autoCastCenterX(0, 2, 0, FULL)).toBeCloseTo(75, 5);
  expect(autoCastCenterX(1, 2, 0, FULL)).toBeCloseTo(25, 5);

  // 单角色恒为正中；count <= 0 也不产出 NaN。
  expect(autoCastCenterX(0, 1, 0, FULL)).toBe(50);
  expect(autoCastCenterX(0, 0, -1, FULL)).toBe(50);

  // 舞台只占多显示器并集一部分时，自动摆位跟着 area 走。
  const area = { x: -50, y: 0, width: 50, height: 100 };
  expect(autoCastCenterX(0, 3, 0, area)).toBeCloseTo(-25, 5);
});

