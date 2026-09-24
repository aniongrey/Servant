import type { MiddlewareHost } from './httpMiddleware.ts';
import { apiPathOf, sendJson } from './httpMiddleware.ts';
import { readOllamaStreamStart } from './OllamaStreamError.ts';

export const OLLAMA_API_PREFIX = '/api/ollama/';
export const OLLAMA_BASE_URL =
  process.env.SHIRO_OLLAMA_URL?.trim() || 'http://127.0.0.1:11434/api/';

const OLLAMA_TIMEOUT_MS = 25_000;

/**
 * Relays `/api/ollama/*` to the machine's local Ollama. The browser cannot talk
 * to 11434 directly because of CORS, so the backend owns this hop.
 */
export function ollamaProxyApi() {
  const configure = (server: MiddlewareHost) => {
    server.middlewares.use(async (request, response, next) => {
      if (!request.url?.startsWith(OLLAMA_API_PREFIX)) {
        next();
        return;
      }

      const endpoint = apiPathOf(request).slice(OLLAMA_API_PREFIX.length);
      if (!['tags', 'chat'].includes(endpoint) || !['GET', 'POST'].includes(request.method ?? '')) {
        sendJson(response, 404, { error: 'Unsupported Ollama endpoint' });
        return;
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
        const body =
          request.method === 'POST' ? Buffer.concat(await collect(request)).toString('utf8') : undefined;
        const upstream = await fetch(`${OLLAMA_BASE_URL}${endpoint}`, {
          method: request.method,
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body,
          signal: controller.signal
        });
        const reader = upstream.body?.getReader();
        const streamStart = reader ? await readOllamaStreamStart(reader) : { chunks: [], done: true };
        const upstreamError = streamStart.error;
        if (upstreamError) {
          sendJson(response, 502, { error: { message: upstreamError } });
          return;
        }
        response.statusCode = upstream.status;
        response.setHeader(
          'Content-Type',
          upstream.headers.get('content-type') ?? 'application/json; charset=utf-8'
        );
        response.setHeader('Cache-Control', 'no-cache');
        response.flushHeaders?.();
        if (reader) {
          for (const chunk of streamStart.chunks) response.write(Buffer.from(chunk));
          while (!streamStart.done) {
            const { value, done } = await reader.read();
            if (done) break;
            response.write(Buffer.from(value));
          }
        }
        clearTimeout(timeout);
        response.end();
      } catch (error) {
        if (!response.headersSent) {
          sendJson(response, 502, {
            error: {
              message: error instanceof Error ? error.message : 'Unable to reach local Ollama'
            }
          });
        } else {
          response.end();
        }
      }
    });
  };

  return {
    name: 'ollama-local-proxy',
    configureServer: configure,
    configurePreviewServer: configure
  };
}

async function collect(request: AsyncIterable<Buffer>): Promise<Buffer[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks;
}
