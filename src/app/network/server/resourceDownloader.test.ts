import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { downloadResourceToFile, fileExistsAt } from './resourceDownloader.ts';

const PAYLOAD = Buffer.from('shiro-provisioning-download-smoke-test-'.repeat(2000));

let server: Server;
let baseUrl: string;
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'shiro-dl-'));
  server = createServer((request, response) => {
    response.setHeader('Connection', 'close');
    if (request.url === '/missing') {
      response.statusCode = 404;
      response.end('not found');
      return;
    }
    response.setHeader('Content-Length', String(PAYLOAD.length));
    response.end(PAYLOAD);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.close();
  await rm(workDir, { recursive: true, force: true });
});

describe('downloadResourceToFile', () => {
  it('streams bytes to disk and reports progress', async () => {
    const destination = join(workDir, 'nested', 'file.bin');
    const progress: Array<[number, number]> = [];
    const written = await downloadResourceToFile(baseUrl + '/file', destination, {
      onProgress: (received, total) => progress.push([received, total])
    });

    expect(written).toBe(PAYLOAD.length);
    expect(await readFile(destination)).toEqual(PAYLOAD);
    expect(await fileExistsAt(join(workDir, 'nested'), 'file.bin')).toBe(true);
    // No temp `.download` file should linger after a successful rename.
    expect(await fileExistsAt(join(workDir, 'nested'), 'file.bin.download')).toBe(false);
    // Progress must include at least a start and the final total.
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[progress.length - 1][0]).toBe(PAYLOAD.length);
  });

  it('rejects on HTTP error responses', async () => {
    await expect(
      downloadResourceToFile(baseUrl + '/missing', join(workDir, 'absent.bin'))
    ).rejects.toThrow(/404/);
  });
});
