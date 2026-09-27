import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { apiPathOf, applyLocalCors, readRequestBody, sendJson } from './httpMiddleware.ts';

export const AVATAR_IMAGE_API = '/api/avatars';
export const MAX_AVATAR_IMAGE_BYTES = 8 * 1024 * 1024;
const ASSET_ROUTE = /^\/api\/avatars\/([a-f0-9]{64})\.(png|jpg|webp)$/;
const formats = {
  png: { type: 'image/png', extension: 'png', matches: (bytes: Buffer) => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  jpg: { type: 'image/jpeg', extension: 'jpg', matches: (bytes: Buffer) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  webp: { type: 'image/webp', extension: 'webp', matches: (bytes: Buffer) => bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' }
} as const;

/** Stores cropped role avatars in the backend's writable user-data directory. */
export function avatarImageApi(directory: string) {
  const configure = (server: { middlewares: { use(handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void): void } }) => {
    server.middlewares.use((request, response, next) => {
      const route = apiPathOf(request);
      if (route !== AVATAR_IMAGE_API && !route.startsWith(`${AVATAR_IMAGE_API}/`)) {
        next();
        return;
      }
      if (applyLocalCors(request, response, 'GET, POST, OPTIONS')) return;
      void handle(request, response, route).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '头像请求失败';
        const status = (error as { status?: number } | null)?.status ?? (message.includes('size limit') ? 413 : 500);
        sendJson(response, status, { error: message });
      });
    });
  };

  async function handle(request: IncomingMessage, response: ServerResponse, route: string) {
    if (request.method === 'POST' && route === AVATAR_IMAGE_API) {
      const bytes = await readRequestBody(request, MAX_AVATAR_IMAGE_BYTES);
      const format = Object.values(formats).find((candidate) => candidate.matches(bytes));
      if (!format || bytes.length < 16) throw httpError('仅支持有效的 PNG、JPEG 或 WebP 图片');
      const hash = createHash('sha256').update(bytes).digest('hex');
      const fileName = `${hash}.${format.extension}`;
      await mkdir(directory, { recursive: true });
      // ponytail: content-addressed files are kept if a role stops using them; safe cleanup needs cross-window reference tracking.
      await writeFile(path.join(directory, fileName), bytes, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      });
      sendJson(response, 200, { id: fileName, url: `${AVATAR_IMAGE_API}/${fileName}` });
      return;
    }

    const asset = route.match(ASSET_ROUTE);
    if (request.method === 'GET' && asset) {
      const fileName = `${asset[1]}.${asset[2]}`;
      const filePath = path.join(directory, fileName);
      response.statusCode = 200;
      response.setHeader('Content-Type', formats[asset[2] as keyof typeof formats].type);
      response.setHeader('Content-Disposition', 'inline');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      createReadStream(filePath).on('error', () => {
        if (!response.headersSent) sendJson(response, 404, { error: '头像不存在' });
        else response.destroy();
      }).pipe(response);
      return;
    }
    throw httpError('头像路由不存在', 404);
  }

  return { name: 'avatar-image-api', configureServer: configure, configurePreviewServer: configure };
}

function httpError(message: string, status = 400) {
  return Object.assign(new Error(message), { status });
}
