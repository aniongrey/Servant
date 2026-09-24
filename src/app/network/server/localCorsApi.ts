import type { MiddlewareHost } from './httpMiddleware.ts';
import { isAllowedLocalOrigin } from './httpMiddleware.ts';

/**
 * CORS for the packaged app.
 *
 * In development the page origin and the backend origin are the same, so no
 * CORS is involved. In the installed app the webview is served from
 * `tauri.localhost` while the backend runs on a loopback port, making every
 * `/api/*` call cross-origin. Without these headers the webview would reject
 * every response — which is exactly the class of "works in dev, broken in the
 * installer" bug the sidecar split is meant to end.
 *
 * Mounted first so it also answers preflights before any route-specific
 * validation runs.
 */
export function localCorsApi() {
  const configure = (server: MiddlewareHost) => {
    server.middlewares.use((request, response, next) => {
      const origin = request.headers.origin;
      if (!origin) {
        next();
        return;
      }
      if (!isAllowedLocalOrigin(request)) {
        response.statusCode = 403;
        response.end();
        return;
      }
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      // `X-Filename` carries the reference-audio name uploaded by the
      // GPT-SoVITS studio page; the `/tts` stat headers are read by the same
      // page. Without both, the packaged webview sees a preflight failure or
      // silently empty headers — a "works in dev only" symptom.
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Servant-Memory, X-Filename');
      response.setHeader(
        'Access-Control-Expose-Headers',
        'Content-Type, X-Elapsed-Ms, X-Used-Emotion, X-Loaded-Gpt, X-Loaded-Sovits'
      );
      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        response.setHeader('Access-Control-Max-Age', '600');
        response.statusCode = 204;
        response.end();
        return;
      }
      next();
    });
  };
  return { name: 'local-cors', configureServer: configure, configurePreviewServer: configure };
}
