import { PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { isTauriDesktop, startDesktopWindowDrag } from '../../desktop/tauri/navigation';
import { type ChatWindowState, type DragState } from './chatTypes';
import { loadChatWindowState, saveChatWindowState } from './chatStorage';
import { clamp } from './chatPresentation';

export function useChatWindow() {
  const [windowState, setWindowState] = useState<ChatWindowState>(loadChatWindowState);

  const panelRef = useRef<HTMLElement | null>(null);

  const dragRef = useRef<DragState | null>(null);

  useEffect(() => saveChatWindowState(windowState), [windowState]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      const panel = panelRef.current;
      const parent = panel?.parentElement;
      if (!drag || drag.pointerId !== event.pointerId || !panel || !parent) return;
      const parentRect = parent.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const x = clamp(
        event.clientX - parentRect.left - drag.offsetX,
        0,
        Math.max(0, parentRect.width - panelRect.width)
      );
      const y = clamp(
        event.clientY - parentRect.top - drag.offsetY,
        0,
        Math.max(0, parentRect.height - panelRect.height)
      );
      setWindowState((current) => ({ ...current, x, y }));
    };
    const end = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, []);

  useEffect(() => {
    const fitIntoStage = () => {
      const panel = panelRef.current;
      const parent = panel?.parentElement;
      if (!panel || !parent) return;
      const parentRect = parent.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      setWindowState((current) => {
        if (current.x === null || current.y === null) return current;
        const x = clamp(current.x, 0, Math.max(0, parentRect.width - panelRect.width));
        const y = clamp(current.y, 0, Math.max(0, parentRect.height - panelRect.height));
        return x === current.x && y === current.y ? current : { ...current, x, y };
      });
    };
    const frame = window.requestAnimationFrame(fitIntoStage);
    window.addEventListener('resize', fitIntoStage);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', fitIntoStage);
    };
  }, [windowState.minimized]);

  const startDragging = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button, select, input')) return;
    if (isTauriDesktop()) {
      event.preventDefault();
      void startDesktopWindowDrag();
      return;
    }
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  return { windowState, setWindowState, panelRef, startDragging };
}
