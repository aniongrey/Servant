/**
 * Desktop-only navigation helpers.
 *
 * Keep the browser build usable: when it is not hosted by Tauri the same
 * controls simply navigate to the corresponding SPA view.
 */
export function isTauriDesktop(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

/** Secondary pages live under `pages/`; only `index.html` / `pages.html` are at the root. */
export type DesktopPageName = 'settings' | 'debug' | 'chat-test' | 'setup';

function desktopBrowserUrl(page: DesktopPageName, search = ''): string {
  return new URL(
    `/pages/${page}.html${search}`,
    window.location.protocol.startsWith('http') ? window.location.origin : 'http://localhost:5173'
  ).href;
}

async function openBrowserPage(page: 'settings' | 'debug'): Promise<void> {
  const url = desktopBrowserUrl(page);
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function openDebugRenderer(): Promise<void> {
  if (!isTauriDesktop()) return openBrowserPage('debug');
  return openInternalDesktopWindow('debug');
}

export function openSettingsHome(): Promise<void> {
  if (!isTauriDesktop()) return openBrowserPage('settings');
  return openInternalDesktopWindow('settings');
}

async function openInternalDesktopWindow(
  label: 'chat' | 'debug' | 'settings' | 'setup'
): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_app_window', { label });
  } catch (error) {
    console.error(`Unable to open Tauri ${label} window`, error);
  }
}

export function openChatWindow(): Promise<void> {
  if (!isTauriDesktop()) {
    window.open(desktopBrowserUrl('chat-test'), '_blank', 'noopener,noreferrer');
    return Promise.resolve();
  }

  return openInternalDesktopWindow('chat');
}

export function openSetupWindow(): Promise<void> {
  if (!isTauriDesktop()) {
    window.open(desktopBrowserUrl('setup'), '_blank', 'noopener,noreferrer');
    return Promise.resolve();
  }

  return openInternalDesktopWindow('setup');
}

export async function openPetContextMenu(point?: { x: number; y: number }): Promise<void> {
  if (!isTauriDesktop()) {
    const url = new URL('/index.html?view=desktop-menu', window.location.href);
    const popup = window.open(
      url.href,
      'shiro-desktop-menu',
      `popup,width=240,height=320,left=${Math.round(point?.x ?? window.screenX)},top=${Math.round(
        point?.y ?? window.screenY
      )}`
    );
    popup?.focus();
    return;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_pet_menu');
  } catch (error) {
    console.error('Unable to open character menu', error);
  }
}

async function currentDesktopWindowAction(
  action: 'minimize' | 'hide' | 'close' | 'toggleMaximize'
): Promise<void> {
  if (!isTauriDesktop()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow()[action]();
  } catch (error) {
    console.error(`Unable to ${action} desktop window`, error);
  }
}

export function minimizeCurrentDesktopWindow(): Promise<void> {
  return currentDesktopWindowAction('minimize');
}

export function toggleMaximizeCurrentDesktopWindow(): Promise<void> {
  return currentDesktopWindowAction('toggleMaximize');
}

export function hideCurrentDesktopWindow(): Promise<void> {
  return currentDesktopWindowAction('hide');
}

export function closeCurrentDesktopWindow(): Promise<void> {
  return currentDesktopWindowAction('close');
}

export async function startDesktopWindowDrag(): Promise<void> {
  if (!isTauriDesktop()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().startDragging();
  } catch (error) {
    console.error('Unable to start desktop window drag', error);
  }
}
