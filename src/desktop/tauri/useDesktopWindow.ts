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
    let moveReleaseTimer: ReturnType<typeof setTimeout> | undefined;
    const onDown = (event: PointerEvent) => {
      clearTimeout(moveReleaseTimer);
      pressed =
        (event.target instanceof Element && !!event.target.closest('button:not([data-window-drag])')) ||
        Boolean(hitTest.current?.(event.clientX, event.clientY));
      if (pressed) root.current?.toggleAttribute('data-interactive', true);
      if (pressed && event.target instanceof Element)
        event.target.closest('button')?.setPointerCapture(event.pointerId);
    };
    const onUp = () => {
      clearTimeout(moveReleaseTimer);
      pressed = false;
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    window.addEventListener('blur', onUp);

    void (async () => {
      const { getCurrentWindow, cursorPosition, availableMonitors, PhysicalPosition } = await import(
        '@tauri-apps/api/window'
      );
      if (disposed) return;
      const current = getCurrentWindow();
      resetCursor = () => current.setIgnoreCursorEvents(false);
      try {
        const saved = parseWindowPosition(localStorage.getItem(POSITION_KEY));
        if (saved) {
          const [size, monitors] = await Promise.all([current.outerSize(), availableMonitors()]);
          if (disposed) return;
          const point = restoreVisiblePosition(
            saved,
            size,
            monitors.map((monitor) => ({ ...monitor.workArea.position, ...monitor.workArea.size }))
          );
          await current.setPosition(new PhysicalPosition(point.x, point.y));
        }
        if (disposed) return;
        const stop = await current.onMoved(({ payload }) => {
          // Native dragging may consume pointerup. Keep input until movement settles.
          clearTimeout(moveReleaseTimer);
          moveReleaseTimer = setTimeout(onUp, 150);
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

      await current.setIgnoreCursorEvents(false);
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
          const buttons = root.current?.querySelectorAll<HTMLButtonElement>('button') ?? [];
          const buttonHit = [...buttons].some((button) => {
            const box = button.getBoundingClientRect();
            return !button.disabled && x >= box.left && x < box.right && y >= box.top && y < box.bottom;
          });
          const interactive = pressed || buttonHit || Boolean(hitTest.current?.(x, y));
          if (ignored === interactive) {
            root.current?.toggleAttribute('data-interactive', interactive);
            await current.setIgnoreCursorEvents(!interactive);
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
      clearTimeout(moveReleaseTimer);
      unlisten?.();
      void resetCursor?.().catch(() => undefined);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('blur', onUp);
    };
  }, [root, hitTest]);
}
