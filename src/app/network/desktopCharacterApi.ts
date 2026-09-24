import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { apiPathOf, applyLocalCors, readRequestBody, sendJson } from './server/httpMiddleware.ts';
import { resolveProjectPaths } from './server/projectPaths.ts';
import { isDesktopCharacterSettings } from '../../desktop/tauri/characterSettings.ts';

export const DESKTOP_CHARACTER_API = '/api/desktop-character';
const MODEL_ASSET_ROUTE = /^\/api\/desktop-character\/models\/([a-f0-9]{64})$/;

/** Writable-root-relative home of the uploaded desktop models. */
export const DESKTOP_CHARACTER_DIRECTORY = '.local/desktop-character';

/**
 * Resolved against the writable root rather than the working directory: once
 * packaged the CWD is the read-only folder holding the executable.
 */
export const DEFAULT_DESKTOP_CHARACTER_DIRECTORY = path.resolve(
  resolveProjectPaths().data,
  DESKTOP_CHARACTER_DIRECTORY
);

/**
 * Model bytes and render settings shared between the pet window, the chat window
 * and the settings window. Uploaded models are content addressed, so importing
 * the same file twice stores it once.
 */
export function desktopCharacterApi(directory = DEFAULT_DESKTOP_CHARACTER_DIRECTORY) {
  const configure = (server: {
    middlewares: {
      use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void;
    };
  }) => {
    server.middlewares.use((request, response, next) => {
      const route = apiPathOf(request);
      if (route !== DESKTOP_CHARACTER_API && !route.startsWith(`${DESKTOP_CHARACTER_API}/`)) {
        next();
        return;
      }
      void handle(request, response, route).catch((error) => {
        sendJson(response, 400, {
          error: error instanceof Error ? error.message : 'Character settings request failed'
        });
      });
    });
  };

  async function handle(request: IncomingMessage, response: ServerResponse, route: string) {
    if (applyLocalCors(request, response, 'GET, PUT, POST, OPTIONS')) return;
    const assetMatch = route.match(MODEL_ASSET_ROUTE);
    if (request.method === 'GET' && (route === DESKTOP_CHARACTER_API || assetMatch)) {
      try {
        const file = await readFile(
          path.join(directory, assetMatch ? `${assetMatch[1]}.vrm` : 'settings.json')
        );
        response.statusCode = 200;
        response.setHeader(
          'Content-Type',
          assetMatch ? 'model/gltf-binary' : 'application/json; charset=utf-8'
        );
        response.setHeader('Cache-Control', 'no-store');
        response.end(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        response.statusCode = 404;
        response.end('{}');
      }
      return;
    }
    if (request.method === 'POST' && route === `${DESKTOP_CHARACTER_API}/models`) {
      const data = await readRequestBody(request, 128 * 1024 * 1024);
      if (
        data.length < 12 ||
        data.toString('ascii', 0, 4) !== 'glTF' ||
        data.readUInt32LE(4) !== 2 ||
        data.readUInt32LE(8) !== data.length
      )
        throw new Error('Invalid VRM/GLB file');
      const hash = createHash('sha256').update(data).digest('hex');
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, `${hash}.vrm`), data);
      sendJson(response, 200, { asset: `${DESKTOP_CHARACTER_API}/models/${hash}` });
      return;
    }
    if (request.method === 'PUT' && route === DESKTOP_CHARACTER_API) {
      const data = await readRequestBody(request, 256 * 1024);
      const settings: unknown = JSON.parse(data.toString('utf8'));
      if (!isDesktopCharacterSettings(settings)) throw new Error('Invalid character settings');
      await mkdir(directory, { recursive: true });
      const temp = path.join(directory, `settings-${randomUUID()}.tmp`);
      await writeFile(temp, JSON.stringify(settings));
      await rename(temp, path.join(directory, 'settings.json'));
      sendJson(response, 200, { ok: true });
      return;
    }
    response.statusCode = 405;
    response.end('{}');
  }

  return { name: 'desktop-character-api', configureServer: configure, configurePreviewServer: configure };
}
