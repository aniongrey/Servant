import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { avatarImageApi, MAX_AVATAR_IMAGE_BYTES } from './avatarImageApi';

describe('role avatar image API', () => {
  let server: Server | undefined;
  let directory: string | undefined;
  afterEach(async () => {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function start() {
    directory = await mkdtemp(path.join(os.tmpdir(), 'servant-avatar-test-'));
    const plugin = avatarImageApi(directory);
    plugin.configureServer({
      middlewares: {
        use: (handler) => {
          server = createServer((request, response) => handler(request, response, () => { response.statusCode = 404; response.end(); }));
        }
      }
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server!.address() as { port: number }).port}/api/avatars`;
  }

  it('stores an accepted cropped image and serves it back from disk', async () => {
    const url = await start();
    const bytes = Buffer.alloc(32, 7);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
    const upload = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes });
    expect(upload.status).toBe(200);
    const result = await upload.json() as { id: string; url: string };
    expect(result.id).toMatch(/^[a-f0-9]{64}\.png$/);
    expect(result.url).toBe(`/api/avatars/${result.id}`);
    const image = await fetch(new URL(result.url, url), { headers: { Origin: 'http://tauri.localhost' } });
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(image.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await image.arrayBuffer())).toEqual(bytes);
  });

  it('rejects unsupported image bytes and untrusted origins', async () => {
    const url = await start();
    expect((await fetch(url, { method: 'POST', body: '<svg/>' })).status).toBe(400);
    expect((await fetch(url, { method: 'POST', body: Buffer.alloc(MAX_AVATAR_IMAGE_BYTES + 1) })).status).toBe(413);
    expect((await fetch(url, { method: 'POST', headers: { Origin: 'https://example.com' }, body: 'image' })).status).toBe(403);
  });
});
