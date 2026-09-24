import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Middleware } from '../app/network/server/httpMiddleware.ts';

/**
 * Minimal connect-compatible request chain.
 *
 * The API modules are written against connect's `(request, response, next)`
 * contract because that is what Vite hands them. Running the same handlers on a
 * plain `node:http` server is what lets one route table serve both the dev
 * server and the packaged sidecar, so this replaces connect rather than
 * reimplementing the modules.
 */
export function createRequestListener(
  middlewares: readonly Middleware[],
  fallback: (request: IncomingMessage, response: ServerResponse) => void
): (request: IncomingMessage, response: ServerResponse) => void {
  const chain = [...middlewares];
  return (request, response) => {
    let index = 0;
    const next = (error?: unknown): void => {
      if (error) {
        fail(response, error);
        return;
      }
      const handler = chain[index++];
      if (!handler) {
        fallback(request, response);
        return;
      }
      try {
        handler(request, response, next);
      } catch (cause) {
        fail(response, cause);
      }
    };
    next();
  };
}

function fail(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  response.statusCode = 500;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(
    JSON.stringify({ error: error instanceof Error ? error.message : 'Internal backend error' })
  );
}
