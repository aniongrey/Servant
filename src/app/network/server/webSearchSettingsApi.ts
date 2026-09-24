import type { MiddlewareHost } from './httpMiddleware.ts';
import { apiPathOf, isRecord, readRequestText, sendJson } from './httpMiddleware.ts';
import { readMutableFile, writeMutableFile, type ProjectPaths } from './projectPaths.ts';

export const WEB_SEARCH_SETTINGS_API = '/api/web-search-settings';
export const WEB_SEARCH_SETTINGS_FILE = 'src/app/network/assets/web-search-settings.json';

/**
 * Durable toggle for the web search tool. Each chat turn carries the flag
 * itself; this endpoint only owns the stored setting.
 */
export function webSearchSettingsApi(paths: ProjectPaths) {
  let enabled = false;
  let loaded = false;

  const load = async (): Promise<void> => {
    if (loaded) return;
    try {
      const body = JSON.parse(await readMutableFile(paths, WEB_SEARCH_SETTINGS_FILE)) as {
        enabled?: unknown;
      };
      if (typeof body.enabled === 'boolean') enabled = body.enabled;
    } catch {
      await writeMutableFile(paths, WEB_SEARCH_SETTINGS_FILE, `${JSON.stringify({ enabled }, null, 2)}\n`);
    }
    loaded = true;
  };

  const configure = (server: MiddlewareHost) => {
    server.middlewares.use(async (request, response, next) => {
      if (apiPathOf(request) !== WEB_SEARCH_SETTINGS_API) {
        next();
        return;
      }
      await load();
      if (request.method === 'GET') {
        sendJson(response, 200, { enabled });
        return;
      }
      if (request.method !== 'PUT') {
        sendJson(response, 405, { error: 'Web search settings only supports GET and PUT' });
        return;
      }
      try {
        const body = JSON.parse(await readRequestText(request, 64 * 1024)) as { enabled?: unknown };
        if (!isRecord(body) || typeof body.enabled !== 'boolean') {
          sendJson(response, 400, { error: 'enabled must be a boolean' });
          return;
        }
        enabled = body.enabled;
        await writeMutableFile(paths, WEB_SEARCH_SETTINGS_FILE, `${JSON.stringify({ enabled }, null, 2)}\n`);
        sendJson(response, 200, { enabled });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Invalid JSON body' });
      }
    });
  };

  return { name: 'web-search-settings', configureServer: configure, configurePreviewServer: configure };
}
