import { afterEach, expect, it, vi } from 'vitest';
import type { CharacterHitPart } from '../../character/vrm/modelHitTest';
import { useDesktopWindow } from './useDesktopWindow';

const native = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  setIgnoreCursorEvents: vi.fn().mockResolvedValue(undefined),
  onMoved: vi.fn().mockResolvedValue(() => {}),
  setPosition: vi.fn().mockResolvedValue(undefined),
  outerPosition: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
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
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
afterEach(() => {
  cleanup?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('keeps the whole Galgame stage interactive, then restores pet hit testing', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', Object.assign(new EventTarget(), { __TAURI_INTERNALS__: { invoke: native.invoke } }));
  vi.stubGlobal('localStorage', { getItem: () => '{"x":100,"y":100}', setItem: vi.fn() });
  const root = { current: { dataset: { stage: 'true' }, querySelectorAll: () => [], toggleAttribute: vi.fn() } };
  useDesktopWindow(root as never, { current: () => null });
  await vi.advanceTimersByTimeAsync(100);
  expect(native.setPosition).not.toHaveBeenCalled();
  expect(native.invoke).toHaveBeenCalledWith('set_stage_cursor_passthrough', { ignore: false });
  expect(native.setIgnoreCursorEvents).not.toHaveBeenCalledWith(true);
  root.current.dataset.stage = 'false';
  await vi.advanceTimersByTimeAsync(100);
  expect(native.setIgnoreCursorEvents).toHaveBeenLastCalledWith(true);
});

it('keeps the hidden Galgame stage interactive over the model and passes the rest through', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', Object.assign(new EventTarget(), { __TAURI_INTERNALS__: { invoke: native.invoke } }));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  const root = { current: { dataset: { stage: 'true', stageUiHidden: 'true' }, querySelectorAll: () => [], toggleAttribute: vi.fn() } };
  // 隐藏界面后窗口不能再整块穿透，也不能整块可交互：
  // 光标落在角色轮廓上要可交互（摸头），轮廓以外照旧穿到桌面。
  const hitTest = { current: vi.fn<(x: number, y: number) => CharacterHitPart | null>(() => 'head') };
  useDesktopWindow(root as never, hitTest);
  await vi.advanceTimersByTimeAsync(100);
  expect(native.invoke).toHaveBeenLastCalledWith('set_stage_cursor_passthrough', { ignore: false });
  native.invoke.mockClear();
  window.dispatchEvent(new Event('blur'));
  await vi.advanceTimersByTimeAsync(0);
  expect(native.invoke).toHaveBeenNthCalledWith(1, 'set_stage_cursor_passthrough', { ignore: false });
  expect(native.invoke).toHaveBeenNthCalledWith(2, 'set_stage_cursor_passthrough', { ignore: true });
  hitTest.current.mockReturnValue(null);
  await vi.advanceTimersByTimeAsync(100);
  expect(native.invoke).toHaveBeenLastCalledWith('set_stage_cursor_passthrough', { ignore: true });
  hitTest.current.mockReturnValue('body');
  await vi.advanceTimersByTimeAsync(100);
  expect(native.invoke).toHaveBeenLastCalledWith('set_stage_cursor_passthrough', { ignore: false });
});

it('ignores invisible buttons when the Galgame UI is hidden', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', Object.assign(new EventTarget(), { __TAURI_INTERNALS__: { invoke: native.invoke } }));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  // UI 是 `visibility: hidden`：按钮看不见也点不到，但仍占着位置。
  // 隐藏态若把它们算成可交互，那片看不见的按钮区就会一直挡住桌面。
  const button = { matches: () => false, getBoundingClientRect: () => ({ left: 0, top: 0, right: 500, bottom: 500 }) };
  const root = {
    current: {
      dataset: { stage: 'true', stageUiHidden: 'true' },
      querySelectorAll: () => [button],
      toggleAttribute: vi.fn()
    }
  };
  const hitTest = { current: vi.fn<(x: number, y: number) => CharacterHitPart | null>(() => null) };
  useDesktopWindow(root as never, hitTest);
  await vi.advanceTimersByTimeAsync(100);
  expect(native.invoke).toHaveBeenLastCalledWith('set_stage_cursor_passthrough', { ignore: true });
  // 同一个按钮在 UI 露着的时候照旧要能点。
  root.current.dataset.stageUiHidden = 'false';
  await vi.advanceTimersByTimeAsync(100);
  expect(native.invoke).toHaveBeenLastCalledWith('set_stage_cursor_passthrough', { ignore: false });
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
  events.__TAURI_INTERNALS__ = { invoke: native.invoke };
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
