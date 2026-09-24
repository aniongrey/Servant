import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { desktopCharacterApi } from './desktopCharacterApi';

describe('shared desktop character API', () => {
  let server: Server | undefined;
  let directory: string | undefined;
  afterEach(async () => {
    if (server)
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve()))
      );
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  async function start() {
    directory = await mkdtemp(path.join(os.tmpdir(), 'shiro-character-test-'));
    const plugin = desktopCharacterApi(directory);
    plugin.configureServer({
      middlewares: {
        use: (handler) => {
          server = createServer((request, response) =>
            handler(request, response, () => {
              response.statusCode = 404;
              response.end();
            })
          );
        }
      }
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server!.address() as { port: number };
    return `http://127.0.0.1:${address.port}/api/desktop-character`;
  }
  it('persists selected settings and imported model bytes for a separate desktop client', async () => {
    const url = await start();
    expect((await fetch(url)).status).toBe(404);
    const bytes = Buffer.alloc(12);
    bytes.write('glTF');
    bytes.writeUInt32LE(2, 4);
    bytes.writeUInt32LE(12, 8);
    const upload = await fetch(`${url}/models`, { method: 'POST', body: bytes });
    expect(upload.ok).toBe(true);
    const { asset } = (await upload.json()) as { asset: string };
    const settings = {
      version: 1,
      model: { id: 'imported-test', asset },
      avatarFit: {},
      renderConfig: {},
      holdMicroMotionEnabled: false,
      footIkEnabled: true
    };
    expect((await fetch(url, { method: 'PUT', body: JSON.stringify(settings) })).ok).toBe(true);
    const desktop = await fetch(url, { headers: { Origin: 'http://tauri.localhost' } });
    expect(desktop.headers.get('access-control-allow-origin')).toBe('http://tauri.localhost');
    expect(await desktop.json()).toEqual(settings);
    const downloaded = await fetch(new URL(asset, url));
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes);
    // A later update replaces the existing on-disk settings on Windows too.
    const next = { ...settings, model: { id: 'main' } };
    expect((await fetch(url, { method: 'PUT', body: JSON.stringify(next) })).ok).toBe(true);
    expect(await (await fetch(url)).json()).toEqual(next);
  });
  it('rejects invalid uploads and cross-origin settings writes without changing stored settings', async () => {
    const url = await start();
    expect((await fetch(`${url}/models`, { method: 'POST', body: 'not a model' })).status).toBe(400);
    expect((await fetch(url, { method: 'PUT', body: '{}' })).status).toBe(400);
    expect(
      (await fetch(url, { method: 'PUT', headers: { Origin: 'https://unrelated.example' }, body: '{}' }))
        .status
    ).toBe(403);
    expect((await fetch(url)).status).toBe(404);
  });
});
