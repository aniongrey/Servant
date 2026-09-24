import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickDirectory } from './directoryPicker';

const open = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/plugin-dialog', () => ({ open }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

function inDesktop(): void {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
}

describe('pickDirectory', () => {
  it('returns the chosen directory', async () => {
    inDesktop();
    open.mockResolvedValue('D:/models/shiro');

    await expect(pickDirectory({ title: '选择目录', defaultPath: 'D:/models' })).resolves.toEqual({
      kind: 'picked',
      path: 'D:/models/shiro'
    });
    expect(open).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: '选择目录',
      defaultPath: 'D:/models'
    });
  });

  it('treats an empty pick as a cancellation', async () => {
    inDesktop();
    open.mockResolvedValue(null);

    await expect(pickDirectory()).resolves.toEqual({ kind: 'cancelled' });
    expect(open).toHaveBeenCalledWith({ directory: true, multiple: false });
  });

  it('reports a host without a native dialog instead of calling one', async () => {
    vi.stubGlobal('window', {});

    await expect(pickDirectory({ defaultPath: 'D:/models' })).resolves.toEqual({ kind: 'unavailable' });
    expect(open).not.toHaveBeenCalled();
  });

  it('retries without the hint when the suggested directory breaks the dialog', async () => {
    inDesktop();
    open
      .mockRejectedValueOnce(new Error('directory does not exist'))
      .mockResolvedValueOnce('D:/models/shiro');

    await expect(pickDirectory({ defaultPath: 'D:/models' })).resolves.toEqual({
      kind: 'picked',
      path: 'D:/models/shiro'
    });
    expect(open.mock.calls).toEqual([
      [{ directory: true, multiple: false, defaultPath: 'D:/models' }],
      [{ directory: true, multiple: false }]
    ]);
  });

  it('reports a real failure', async () => {
    inDesktop();
    open.mockRejectedValue(new Error('dialog unavailable'));

    await expect(pickDirectory()).resolves.toEqual({ kind: 'failed', message: 'dialog unavailable' });
  });
});
