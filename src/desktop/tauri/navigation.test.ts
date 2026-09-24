import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  openChatWindow,
  openDebugRenderer,
  openPetContextMenu,
  openSettingsHome,
  openSettingsWindow
} from './navigation';

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
      location: {
        protocol: 'http:',
        origin: 'http://localhost:4173',
        href: 'http://localhost:4173/pages/desktop.html'
      },
      screenX: 400,
      screenY: 200,
      open
    });
    await openChatWindow();
    await openSettingsHome();
    await openDebugRenderer();
    await openPetContextMenu();
    expect(open.mock.calls.map(([url]) => url)).toEqual([
      'http://localhost:4173/pages/chat.html',
      'http://localhost:4173/pages/settings.html',
      'http://localhost:4173/pages/debug.html',
      'http://localhost:4173/index.html?view=desktop-menu'
    ]);
    expect(open).toHaveBeenLastCalledWith(
      'http://localhost:4173/index.html?view=desktop-menu',
      'servant-desktop-menu',
      'popup,width=240,height=320,left=400,top=200'
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it('asks the native window for the requested settings panel', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    await openSettingsWindow('llm');
    expect(invoke).toHaveBeenCalledWith('open_app_window', { label: 'settings', section: 'llm' });
  });

  it('deep-links the browser settings page to the same panel', async () => {
    const open = vi.fn();
    vi.stubGlobal('window', {
      location: {
        protocol: 'http:',
        origin: 'http://localhost:4173',
        href: 'http://localhost:4173/pages/desktop.html'
      },
      screenX: 400,
      screenY: 200,
      open
    });
    await openSettingsWindow('llm');
    expect(open).toHaveBeenCalledWith(
      'http://localhost:4173/pages/settings.html?section=llm',
      '_blank',
      'noopener,noreferrer'
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});
