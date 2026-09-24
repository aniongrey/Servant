import type { MiddlewareHost } from './httpMiddleware.ts';
import { apiPathOf, readRequestText, sendJson } from './httpMiddleware.ts';
import { readMutableFile, writeMutableFile, type ProjectPaths } from './projectPaths.ts';
import { parseMicroDynamicsConfig } from '../../../character/micro-dynamics/config.ts';

export const MICRO_DYNAMICS_CONFIG_API = '/api/micro-dynamics-config';
export const MICRO_DYNAMICS_CONFIG_FILE = 'src/character/micro-dynamics/micro-dynamics.json';

export function microDynamicsConfigApi(paths: ProjectPaths) {
  const configure = (server: MiddlewareHost) => {
    server.middlewares.use(async (request, response, next) => {
      if (apiPathOf(request) !== MICRO_DYNAMICS_CONFIG_API) {
        next();
        return;
      }
      try {
        if (request.method === 'GET') {
          const config = parseMicroDynamicsConfig(
            JSON.parse(await readMutableFile(paths, MICRO_DYNAMICS_CONFIG_FILE))
          );
          sendJson(response, 200, config);
          return;
        }
        if (request.method !== 'PUT') {
          sendJson(response, 405, { error: 'Micro dynamics config only supports GET and PUT' });
          return;
        }
        const config = parseMicroDynamicsConfig(JSON.parse(await readRequestText(request, 512 * 1024)));
        await writeMutableFile(paths, MICRO_DYNAMICS_CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`);
        sendJson(response, 200, { ok: true });
      } catch (error) {
        sendJson(response, 400, {
          error: error instanceof Error ? error.message : 'Invalid micro dynamics config'
        });
      }
    });
  };
  return {
    name: 'micro-dynamics-config-api',
    configureServer: configure,
    configurePreviewServer: configure
  };
}
