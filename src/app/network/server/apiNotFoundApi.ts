import type { ApiModule, MiddlewareHost } from './httpMiddleware.ts';
import { apiPathOf, applyLocalCors, sendJson } from './httpMiddleware.ts';

/** Every backend route lives under this prefix. */
export const API_PREFIX = '/api/';

/**
 * Last-resort guard for the backend namespace.
 *
 * It is mounted after every other API module, so anything that reaches it is a
 * route nobody claimed. Answering JSON here — instead of letting the host fall
 * through to its HTML entry point — is what keeps a missing or misspelled
 * endpoint from looking like "the API returned `<!doctype html>`", and keeps the
 * Vite dev server and the packaged sidecar behaving the same way.
 */
export function apiNotFoundApi(): ApiModule {
  const configure = (server: MiddlewareHost) => {
    server.middlewares.use((request, response, next) => {
      const route = apiPathOf(request);
      if (!route.startsWith(API_PREFIX)) {
        next();
        return;
      }
      if (applyLocalCors(request, response)) return;
      sendJson(response, 404, { error: `Unknown API route: ${route}` });
    });
  };
  return {
    name: 'api-not-found',
    configureServer: configure,
    configurePreviewServer: configure
  };
}
