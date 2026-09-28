import { isTauriDesktop } from './navigation';

export async function toggleStageFullscreen(): Promise<boolean> {
  if (isTauriDesktop()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const current = getCurrentWindow();
    const next = !await current.isFullscreen();
    await current.setFullscreen(next);
    // 切完全屏必须把样式位再剥一次（见 `fixStageWindowFrame` 的说明）；剥一次往往不够。
    void fixStageWindowFrame();
    return next;
  }
  if (document.fullscreenElement) { await document.exitFullscreen(); return false; }
  await document.documentElement.requestFullscreen();
  return true;
}

/**
 * 让舞台窗口重新收敛成纯客户区（去掉那圈 Windows 原生边框）。
 *
 * **为什么必须重试多次**：`setFullscreen` 返回只代表命令发出去了，窗口管理器随后才
 * 按「这是一个普通窗体」的语义重算非客户区——那圈 `WS_THICKFRAME` 的边框就是那时
 * 补回来的。只剥一次，结果取决于剥的那一刻是不是恰好在系统重算之后，于是表现成
 * 「有时好、有时又出现」。几个间隔各剥一次才能稳。
 *
 * 命令不存在（旧版 Rust 侧还没编译进去）时静默降级，不能因为它把舞台卡住。
 */
export const STAGE_FRAME_FIX_DELAYS_MS = [0, 120, 400, 900] as const;
export async function fixStageWindowFrame(): Promise<void> {
  if (!isTauriDesktop()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  let missing = false;
  for (const delay of STAGE_FRAME_FIX_DELAYS_MS) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      await invoke('fix_stage_window_frame');
    } catch (error) {
      if (String(error).includes('fix_stage_window_frame')) missing = true;
      if (missing) return;
    }
  }
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

/** Keep the stage mounted so its draft and voice endpoint remain available. */
export async function minimizeStage(): Promise<void> {
  if (!isTauriDesktop()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().minimize();
}
