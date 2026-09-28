import { useEffect, type RefObject } from 'react';
import { isTauriDesktop } from './navigation';
import type { ModelHitTest } from '../../character/vrm/modelHitTest';
import { parseWindowPosition, restoreVisiblePosition } from './windowGeometry';

const POSITION_KEY = 'codex-list.desktopWindowPosition.v1';

export function useDesktopWindow(
  root: RefObject<HTMLElement | null>,
  hitTest: RefObject<ModelHitTest | null>
) {
  useEffect(() => {
    if (!isTauriDesktop()) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unlisten: (() => void) | undefined;
    let resetCursor: (() => Promise<void>) | undefined;
    let pressed = false;
    let activePointerId: number | undefined;
    let beginWindowDrag: (() => void) | undefined;
    let windowDrag: { pointerId: number; offsetX: number; offsetY: number } | undefined;
    let getCursorPosition: (() => Promise<{ x: number; y: number }>) | undefined;
    let setWindowPosition: ((x: number, y: number) => Promise<void>) | undefined;
    const onDown = (event: PointerEvent) => {
      activePointerId = event.button === 0 ? event.pointerId : undefined;
      pressed =
        root.current?.dataset?.stage === 'true' ||
        (event.target instanceof Element && !!event.target.closest('button:not([data-window-drag]), input, select, textarea, summary, .desktop-voice-composer')) ||
        Boolean(hitTest.current?.(event.clientX, event.clientY));
      if (pressed && event.button === 0 && event.target instanceof Element && event.target.closest('canvas')) {
        beginWindowDrag = () => {
          beginWindowDrag = undefined;
          void (async () => {
            const { getCurrentWindow, cursorPosition, PhysicalPosition } = await import('@tauri-apps/api/window');
            const current = getCurrentWindow();
            const [cursor, origin] = await Promise.all([cursorPosition(), current.innerPosition()]);
            getCursorPosition = cursorPosition;
            setWindowPosition = (x, y) => current.setPosition(new PhysicalPosition(x, y));
            if (!disposed && activePointerId === event.pointerId) {
              windowDrag = {
                pointerId: event.pointerId,
                offsetX: cursor.x - origin.x,
                offsetY: cursor.y - origin.y
              };
            }
          })().catch((error) => console.error('Unable to begin desktop window drag', error));
        };
      }
      if (pressed) root.current?.toggleAttribute('data-interactive', true);
      if (pressed && event.target instanceof Element)
        event.target.closest('button')?.setPointerCapture(event.pointerId);
    };
    const onModelDrag = () => beginWindowDrag?.();
    const onUp = (event: Event) => {
      if ('pointerId' in event && activePointerId !== undefined && activePointerId !== event.pointerId) return;
      windowDrag = undefined;
      beginWindowDrag = undefined;
      activePointerId = undefined;
      pressed = false;
    };
    const onMove = (event: PointerEvent) => {
      const drag = windowDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      void getCursorPosition?.().then((cursor) => {
        if (windowDrag !== drag) return;
        void setWindowPosition?.(Math.round(cursor.x - drag.offsetX), Math.round(cursor.y - drag.offsetY));
      }).catch((error) => console.error('Unable to follow desktop drag', error));
      event.preventDefault();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('servant-model-drag', onModelDrag, true);
    window.addEventListener('blur', onUp);

    void (async () => {
      const { getCurrentWindow, cursorPosition, PhysicalPosition, availableMonitors } = await import(
        '@tauri-apps/api/window'
      );
      if (disposed) return;
      const current = getCurrentWindow();
      getCursorPosition = cursorPosition;
      setWindowPosition = (x, y) => current.setPosition(new PhysicalPosition(x, y));
      const setCursorIgnored = async (ignore: boolean) => {
        if (root.current?.dataset?.stage === 'true') {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('set_stage_cursor_passthrough', { ignore });
        } else await current.setIgnoreCursorEvents(ignore);
      };
      resetCursor = () => setCursorIgnored(false);
      try {
        const saved = parseWindowPosition(localStorage.getItem(POSITION_KEY));
        const [size, monitors] = await Promise.all([
          typeof current.outerSize === 'function'
            ? current.outerSize()
            : Promise.resolve({ width: 0, height: 0 }),
          typeof availableMonitors === 'function' ? availableMonitors() : Promise.resolve([])
        ]);
        const screens = monitors.map(({ position, size }) => ({
          x: position.x, y: position.y, width: size.width, height: size.height
        }));
        const origin = saved ?? await current.outerPosition();
        const visible = restoreVisiblePosition(origin, size, screens);
        if (!disposed && root.current?.dataset?.stage !== 'true' && (saved || visible.x !== origin.x || visible.y !== origin.y)) {
          await current.setPosition(new PhysicalPosition(visible.x, visible.y));
          if (screens.length) localStorage.setItem(POSITION_KEY, JSON.stringify(visible));
        }
        if (disposed) return;
        const stop = await current.onMoved(({ payload }) => {
          if (localStorage.getItem('servant.desktopStageMode') === 'true') return;
          try {
            localStorage.setItem(POSITION_KEY, JSON.stringify({ x: payload.x, y: payload.y }));
          } catch (error) {
            console.error('Unable to save desktop position', error);
          }
        });
        if (disposed) {
          stop();
          return;
        }
        unlisten = stop;
      } catch (error) {
        console.error('Unable to restore desktop position', error);
      }

      await setCursorIgnored(false);
      if (disposed) return;
      let ignored = false;
      let lastError = '';
      const poll = async () => {
        try {
          const [cursor, origin, scale] = await Promise.all([
            cursorPosition(),
            current.innerPosition(),
            current.scaleFactor()
          ]);
          if (disposed) return;
          const x = (cursor.x - origin.x) / scale;
          const y = (cursor.y - origin.y) / scale;
          const buttons = root.current?.querySelectorAll<HTMLElement>('button, input, select, textarea, summary, .desktop-voice-composer') ?? [];
          const buttonHit = [...buttons].some((button) => {
            const box = button.getBoundingClientRect();
            return !button.matches(':disabled') && x >= box.left && x < box.right && y >= box.top && y < box.bottom;
          });
          /**
           * 隐藏界面之后窗口**不能整块穿透**，也不能整块可交互。
           *
           * 舞台是「透明背景 + 全屏」的窗口。UI 露着的时候整块窗口都可交互是对的——
           * 顶栏、工具栏、对白框散在四周，光标得能落在任意一处。但按下 H 把 UI 藏起来
           * 之后，屏幕上只剩角色自己；此时如果照旧整块可交互，透明的窗口面会把整个桌面
           * 都挡住（正是「点到其他页面它最上方会显示这个东西」那一类问题）；而如果像
           * 原来那样整块设成穿透，摸头这套交互（以及点角色把界面唤回来）也跟着没了。
           *
           * 所以隐藏态改成**按模型轮廓判定**：只有光标落在角色骨骼胶囊上才算可交互，
           * 其余区域照旧穿到桌面。`hitTest` 就是那条骨骼胶囊链路的入口。
           */
          const stageHidden =
            root.current?.dataset?.stage === 'true' && root.current?.dataset?.stageUiHidden === 'true';
          const modelHit = Boolean(hitTest.current?.(x, y));
          /*
            隐藏态**不能**再把 `buttonHit` 算进来：UI 是 `visibility: hidden`，
            按钮虽然看不见、点不到，却仍然占着位置（`getBoundingClientRect` 照旧有尺寸）。
            把它们算成可交互，等于让那些看不见的按钮继续挡住桌面。
          */
          const interactive =
            root.current?.dataset?.stage === 'true'
              ? stageHidden
                ? pressed || modelHit
                : true
              : pressed || buttonHit || modelHit;
          if (ignored === interactive) {
            root.current?.toggleAttribute('data-interactive', interactive);
            await setCursorIgnored(!interactive);
            ignored = !interactive;
          }
          lastError = '';
        } catch (error) {
          if (String(error) !== lastError) console.error('Desktop mouse hit testing failed', error);
          lastError = String(error);
          // Fail open so the close/settings buttons remain recoverable.
          await resetCursor?.().catch(() => undefined);
          ignored = false;
          if (!disposed) timer = setTimeout(() => void poll(), 1000);
          return;
        }
        if (!disposed) timer = setTimeout(() => void poll(), 32);
        else await resetCursor?.().catch(() => undefined);
      };
      await poll();
    })().catch((error) => console.error('Unable to initialize desktop window', error));

    return () => {
      disposed = true;
      clearTimeout(timer);
      unlisten?.();
      void resetCursor?.().catch(() => undefined);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('servant-model-drag', onModelDrag, true);
      window.removeEventListener('blur', onUp);
    };
  }, [root, hitTest]);
}
