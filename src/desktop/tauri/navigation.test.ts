import { afterEach, describe, expect, it, vi } from 'vitest';
import { openChatWindow, openDebugRenderer, openPetContextMenu, openSettingsHome } from './navigation';

const invoke = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('desktop navigation', () => {
  it('routes every desktop page and the character menu to native commands', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    await openChatWindow();
    await openSettingsHome();
    await openDebugRenderer();
    await openPetContextMenu();
    expect(invoke.mock.calls).toEqual([
      ['open_app_window', { label: 'chat' }],
      ['open_app_window', { label: 'settings' }],
      ['open_app_window', { label: 'debug' }],
      ['open_pet_menu']
    ]);
  });

  it('opens browser pages on the current origin without invoking Tauri', async () => {
    const open = vi.fn();
    vi.stubGlobal('window', {
      location: { protocol: 'http:', origin: 'http://localhost:4173', href: 'http://localhost:4173/pages/desktop.html' },
      screenX: 400, screenY: 200, open
    });
    await openChatWindow();
    await openSettingsHome();
    await openDebugRenderer();
    await openPetContextMenu();
    expect(open.mock.calls.map(([url]) => url)).toEqual([
      'http://localhost:4173/pages/chat-test.html',
      'http://localhost:4173/pages/settings.html',
      'http://localhost:4173/pages/debug.html',
      'http://localhost:4173/index.html?view=desktop-menu'
    ]);
    expect(open).toHaveBeenLastCalledWith('http://localhost:4173/index.html?view=desktop-menu',
      'shiro-desktop-menu', 'popup,width=240,height=320,left=400,top=200');
    expect(invoke).not.toHaveBeenCalled();
  });
});
