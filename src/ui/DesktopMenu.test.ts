import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDesktopMenuAction } from './DesktopMenu';
import { openPetContextMenu } from '../desktop/tauri/navigation';

const invoke = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('shared themed desktop menu', () => {
  it('opens browser character menus in a separate popup at screen coordinates', async () => {
    const focus = vi.fn();
    const open = vi.fn(() => ({ focus }));
    vi.stubGlobal('window', { location: { href: 'http://localhost:5173/pages/desktop.html' }, open });
    await openPetContextMenu({ x: 1200, y: 850 });
    expect(open).toHaveBeenCalledWith('http://localhost:5173/index.html?view=desktop-menu',
      'shiro-desktop-menu', 'popup,width=240,height=320,left=1200,top=850');
    expect(focus).toHaveBeenCalled();
  });
  it('routes all role and tray actions to the same native dispatcher', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    for (const label of ['toggle-pet', 'chat', 'settings', 'restart', 'quit'] as const) {
      await runDesktopMenuAction(label);
      expect(invoke).toHaveBeenLastCalledWith('run_desktop_menu_action', { label });
    }
  });
  it('keeps browser navigation available and ignores desktop-only actions', async () => {
    const open = vi.fn();
    vi.stubGlobal('window', { location: { protocol: 'http:', origin: 'http://localhost:5173' }, open });
    await runDesktopMenuAction('settings');
    await runDesktopMenuAction('restart');
    await runDesktopMenuAction('quit');
    expect(open).toHaveBeenCalledWith('http://localhost:5173/pages/settings.html', '_blank', 'noopener,noreferrer');
    expect(invoke).not.toHaveBeenCalled();
  });
});
