import type { MiddlewareHost } from './httpMiddleware.ts';
import { apiPathOf, readRequestText, sendJson } from './httpMiddleware.ts';
import { readMutableFile, writeMutableFile, type ProjectPaths } from './projectPaths.ts';
import { validateEmotionConfig } from '../../../character/motion/actions/emotionConfig.ts';
import { FULL_BODY_MOTION_CONFIG_FILE, VRMA_SEGMENTS_FILE } from './vrmaSegmentsApi.ts';

export const FULL_BODY_MOTION_CONFIG_API = '/api/full-body-motion-config';

/** Editor endpoint for emotion -> motion bindings. */
export function fullBodyMotionConfigApi(paths: ProjectPaths) {
  const configure = (server: MiddlewareHost) => {
    server.middlewares.use(async (request, response, next) => {
      if (apiPathOf(request) !== FULL_BODY_MOTION_CONFIG_API) {
        next();
        return;
      }
      try {
        if (request.method === 'GET') {
          sendJson(
            response,
            200,
            JSON.parse(await readMutableFile(paths, FULL_BODY_MOTION_CONFIG_FILE))
          );
          return;
        }
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'Only GET and POST are supported' });
          return;
        }
        const config = validateEmotionConfig(
          JSON.parse(await readRequestText(request, 1024 * 1024)),
          JSON.parse(await readMutableFile(paths, VRMA_SEGMENTS_FILE))
        );
        await writeMutableFile(
          paths,
          FULL_BODY_MOTION_CONFIG_FILE,
          `${JSON.stringify(config, null, 2)}\n`
        );
        sendJson(response, 200, { ok: true });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    });
  };
  return {
    name: 'full-body-config-api',
    configureServer: configure,
    configurePreviewServer: configure
  };
}
