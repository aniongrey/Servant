import type { ApiModule, MiddlewareHost } from './httpMiddleware.ts';
import { readRequestText, sendJson } from './httpMiddleware.ts';
import { readMutableFile, writeMutableFile, type ProjectPaths } from './projectPaths.ts';

export const ACTION_CONFIG_API_PREFIX = '/api/action-configs/';
export const ACTION_CONFIG_FILE = 'src/character/motion/assets/actions/action-configs.json';

/** Editor endpoint for per-action motion split points and notes. */
export function actionConfigApi(paths: ProjectPaths): ApiModule {
  const configure = (server: MiddlewareHost) => {
    server.middlewares.use(async (request, response, next) => {
      if (request.method !== 'PUT' || !request.url?.startsWith(ACTION_CONFIG_API_PREFIX)) {
        next();
        return;
      }

      try {
        const actionId = decodeURIComponent(request.url.slice(ACTION_CONFIG_API_PREFIX.length).split('?')[0]);
        const body = JSON.parse(await readRequestText(request, 256 * 1024)) as {
          split?: unknown;
          note?: unknown;
        };
        const hasSplit = body.split !== undefined;
        const hasNote = body.note !== undefined;
        if (!hasSplit && !hasNote) {
          sendJson(response, 400, { error: 'At least one of split or note is required' });
          return;
        }
        if (hasSplit && !isValidSplit(body.split)) {
          sendJson(response, 400, { error: 'split must be two ascending, non-negative numbers' });
          return;
        }
        if (hasNote && (typeof body.note !== 'string' || body.note.length > 500)) {
          sendJson(response, 400, { error: 'note must be a string with at most 500 characters' });
          return;
        }

        const configs = JSON.parse(await readMutableFile(paths, ACTION_CONFIG_FILE)) as Array<
          Record<string, unknown>
        >;
        const action = configs.find((config) => config.id === actionId);
        if (!action) {
          sendJson(response, 404, { error: `Unknown action: ${actionId}` });
          return;
        }

        if (hasSplit) {
          action.split = body.split;
          delete action.hold;
          delete action.exit;
          if (action.oneShot !== true) delete action.enter;
        }
        if (hasNote) action.note = (body.note as string).trim();
        await writeMutableFile(paths, ACTION_CONFIG_FILE, `${JSON.stringify(configs, null, 2)}\n`);
        sendJson(response, 200, { actionId, split: action.split, note: action.note });
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : 'Failed to save action config'
        });
      }
    });
  };
  return { name: 'action-config-writer', configureServer: configure, configurePreviewServer: configure };
}

function isValidSplit(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((point) => typeof point === 'number' && Number.isFinite(point) && point >= 0) &&
    value[0] < value[1]
  );
}
