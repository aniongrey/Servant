import { afterEach, expect, it, vi } from 'vitest';
import { useDesktopWindow } from './useDesktopWindow';

const native = vi.hoisted(() => ({
  setIgnoreCursorEvents: vi.fn().mockResolvedValue(undefined),
  onMoved: vi.fn(),
  innerPosition: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
  scaleFactor: vi.fn().mockResolvedValue(1)
}));
let cleanup: (() => void) | undefined;
vi.mock('react', () => ({ useEffect: (effect: () => (() => void)) => { cleanup = effect(); } }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => native,
  cursorPosition: async () => ({ x: 100, y: 100 }),
  availableMonitors: async () => [],
  PhysicalPosition: class {}
}));
afterEach(() => {
  cleanup?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('keeps model presses interactive across animation and native movement, then restores pass-through', async () => {
  vi.useFakeTimers();
  const events = new EventTarget() as EventTarget & { __TAURI_INTERNALS__: object };
  events.__TAURI_INTERNALS__ = {};
  vi.stubGlobal('window', events);
  vi.stubGlobal('Element', class {});
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  let moved: () => void = () => {};
  native.onMoved.mockImplementation(async (callback) => {
    moved = () => callback({ payload: { x: 10, y: 20 } });
    return () => {};
  });
  const root = { current: { querySelectorAll: () => [], toggleAttribute: vi.fn() } };
  const hitTest = { current: vi.fn(() => true) };
  useDesktopWindow(root as never, hitTest);
  await vi.advanceTimersByTimeAsync(0);
  const down = new Event('pointerdown');
  Object.assign(down, { clientX: 100, clientY: 100, pointerId: 1, button: 2 });
  events.dispatchEvent(down);
  hitTest.current.mockReturnValue(false);
  await vi.advanceTimersByTimeAsync(64);
  expect(native.setIgnoreCursorEvents).not.toHaveBeenCalledWith(true);
  moved();
  await vi.advanceTimersByTimeAsync(100);
  moved();
  await vi.advanceTimersByTimeAsync(100);
  expect(native.setIgnoreCursorEvents).not.toHaveBeenCalledWith(true);
  await vi.advanceTimersByTimeAsync(100);
  expect(native.setIgnoreCursorEvents).toHaveBeenLastCalledWith(true);
  hitTest.current.mockReturnValue(true);
  await vi.advanceTimersByTimeAsync(32);
  expect(native.setIgnoreCursorEvents).toHaveBeenLastCalledWith(false);
  events.dispatchEvent(down);
  hitTest.current.mockReturnValue(false);
  events.dispatchEvent(new Event('pointerup'));
  await vi.advanceTimersByTimeAsync(32);
  expect(native.setIgnoreCursorEvents).toHaveBeenLastCalledWith(true);
});
