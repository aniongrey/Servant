import { isTauriDesktop } from './navigation';

export async function toggleStageFullscreen(): Promise<boolean> {
  if (isTauriDesktop()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const current = getCurrentWindow();
    const next = !await current.isFullscreen();
    await current.setFullscreen(next);
    return next;
  }
  if (document.fullscreenElement) { await document.exitFullscreen(); return false; }
  await document.documentElement.requestFullscreen();
  return true;
}
export async function setStageOnTop(enabled: boolean): Promise<void> {
  if (!isTauriDesktop()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().setAlwaysOnTop(enabled);
}
export async function resizeStage(direction: 'North' | 'South' | 'East' | 'West' | 'NorthEast' | 'NorthWest' | 'SouthEast' | 'SouthWest'): Promise<void> {
  if (!isTauriDesktop()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().startResizeDragging(direction);
}
