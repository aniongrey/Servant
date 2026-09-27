import { expect, it } from 'vitest';
import { castSlot, screenStageArea } from './desktopCastLayout';

it.each([0, 1, 2])('places three characters on the selected screen with main index %i in the middle', (mainIndex) => {
  // Different monitor sizes and negative origins model a mixed-DPI, offset desktop.
  const monitors = [
    { x: -1920, y: 0, width: 1920, height: 1080 },
    { x: 0, y: -360, width: 2560, height: 1440 }
  ];
  for (const monitor of monitors) {
    const work = { ...monitor, height: monitor.height - 40 };
    const area = screenStageArea(work, monitors);
    const centers = [0, 1, 2].map((index) =>
      -1920 + (area.x + (castSlot(index, 3, mainIndex) + 0.5) * area.width / 3) / 100 * 4480
    );
    expect(centers[mainIndex]).toBeCloseTo(work.x + work.width / 2);
    centers.sort((a, b) => a - b).forEach((center, slot) => {
      expect(center).toBeCloseTo(work.x + (slot + 0.5) * work.width / 3);
    });
    expect(1080 - area.y / 100 * 1440).toBeCloseTo(work.y + work.height);
    expect(area.height / 100 * 1440).toBeCloseTo(work.height);
  }
});
