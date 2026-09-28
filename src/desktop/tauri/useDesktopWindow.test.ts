import { afterEach, expect, it, vi } from 'vitest';
import type { CharacterHitPart } from '../../character/vrm/modelHitTest';
import { useDesktopWindow } from './useDesktopWindow';

const native = vi.hoisted(() => ({
  setIgnoreCursorEvents: vi.fn().mockResolvedValue(undefined),
  onMoved: vi.fn().mockResolvedValue(() => {}),
  setPosition: vi.fn().mockResolvedValue(undefined),
  outerSize: vi.fn().mockResolvedValue({ width: 1080, height: 1080 }),
  availableMonitors: vi.fn().mockResolvedValue([]),
  innerPosition: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
  scaleFactor: vi.fn().mockResolvedValue(1)
}));
let cleanup: (() => void) | undefined;
vi.mock('react', () => ({
  useEffect: (effect: () => () => void) => {
    cleanup = effect();
  }
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => native,
  cursorPosition: async () => ({ x: 100, y: 100 }),
  availableMonitors: native.availableMonitors,
  PhysicalPosition: class {
    constructor(public x: number, public y: number) {}
  }
}));
afterEach(() => {
  cleanup?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('keeps the whole Galgame stage interactive, then restores pet hit testing', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', Object.assign(new EventTarget(), { __TAURI_INTERNALS__: {} }));
  vi.stubGlobal('localStorage', { getItem: () => '{"x":100,"y":100}', setItem: vi.fn() });
  const root = { current: { dataset: { stage: 'true' }, querySelectorAll: () => [], toggleAttribute: vi.fn() } };
  useDesktopWindow(root as never, { current: () => null });
  await vi.advanceTimersByTimeAsync(100);
  expect(native.setPosition).not.toHaveBeenCalled();
  expect(native.setIgnoreCursorEvents).not.toHaveBeenCalledWith(true);
  root.current.dataset.stage = 'false';
  await vi.advanceTimersByTimeAsync(100);
  expect(native.setIgnoreCursorEvents).toHaveBeenLastCalledWith(true);
});

it('passes mouse input through the hidden Galgame stage and restores interaction when shown', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', Object.assign(new EventTarget(), { __TAURI_INTERNALS__: {} }));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  const root = { current: { dataset: { stage: 'true', stageUiHidden: 'true' }, querySelectorAll: () => [], toggleAttribute: vi.fn() } };
  useDesktopWindow(root as never, { current: () => 'body' });
  await vi.advanceTimersByTimeAsync(100);
  expect(native.setIgnoreCursorEvents).toHaveBeenLastCalledWith(true);
  root.current.dataset.stageUiHidden = 'false';
  await vi.advanceTimersByTimeAsync(100);
  expect(native.setIgnoreCursorEvents).toHaveBeenLastCalledWith(false);
});

it('applies a valid saved position on a connected secondary monitor', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', Object.assign(new EventTarget(), { __TAURI_INTERNALS__: {} }));
  vi.stubGlobal('localStorage', { getItem: () => '{"x":-1500,"y":0}', setItem: vi.fn() });
  native.availableMonitors.mockResolvedValueOnce([
    { position: { x: -1920, y: 0 }, size: { width: 1920, height: 1080 } }
  ]);
  const root = { current: { querySelectorAll: () => [], toggleAttribute: vi.fn() } };
  useDesktopWindow(root as never, { current: () => null });
  await vi.advanceTimersByTimeAsync(0);
  expect(native.setPosition).toHaveBeenCalledWith(expect.objectContaining({ x: -1500, y: 0 }));
});

it('keeps model presses interactive across animation and native movement, then restores pass-through', async () => {
  vi.useFakeTimers();
  const events = new EventTarget() as EventTarget & { __TAURI_INTERNALS__: object };
  events.__TAURI_INTERNALS__ = {};
  vi.stubGlobal('window', events);
  vi.stubGlobal('Element', class {});
  vi.stubGlobal('localStorage', { getItem: () => '{"x":-5000,"y":-4000}', setItem: vi.fn() });
  let moved: () => void = () => {};
  native.onMoved.mockImplementation(async (callback) => {
    moved = () => callback({ payload: { x: 10, y: 20 } });
    return () => {};
  });
  const root = { current: { querySelectorAll: () => [], toggleAttribute: vi.fn() } };
  const hitTest = { current: vi.fn<(x: number, y: number) => CharacterHitPart | null>(() => 'body') };
  useDesktopWindow(root as never, hitTest);
  await vi.advanceTimersByTimeAsync(0);
  expect(native.setPosition).toHaveBeenCalledWith(expect.objectContaining({ x: -5000, y: -4000 }));
  const down = new Event('pointerdown');
  Object.assign(down, { clientX: 100, clientY: 100, pointerId: 1, button: 2 });
  events.dispatchEvent(down);
  hitTest.current.mockReturnValue(null);
  await vi.advanceTimersByTimeAsync(64);
  expect(native.setIgnoreCursorEvents).not.toHaveBeenCalledWith(true);
  moved();
  await vi.advanceTimersByTimeAsync(100);
  moved();
  await vi.advanceTimersByTimeAsync(100);
  expect(native.setIgnoreCursorEvents).not.toHaveBeenCalledWith(true);
  events.dispatchEvent(new Event('pointerup'));
  await vi.advanceTimersByTimeAsync(100);
  expect(native.setIgnoreCursorEvents).toHaveBeenLastCalledWith(true);
  hitTest.current.mockReturnValue('body');
  await vi.advanceTimersByTimeAsync(32);
  expect(native.setIgnoreCursorEvents).toHaveBeenLastCalledWith(false);
  events.dispatchEvent(down);
  hitTest.current.mockReturnValue(null);
  events.dispatchEvent(new Event('pointerup'));
  await vi.advanceTimersByTimeAsync(32);
  expect(native.setIgnoreCursorEvents).toHaveBeenLastCalledWith(true);
});
