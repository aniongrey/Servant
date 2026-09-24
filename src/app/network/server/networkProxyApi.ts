import { ProxyAgent, fetch as undiciFetch } from 'undici';
import type { MiddlewareHost } from './httpMiddleware.ts';
import { apiPathOf, isRecord, sendJson } from './httpMiddleware.ts';
import { DEFAULT_GLOBAL_PROXY_URL } from '../../settings/storageKeys.ts';

export const NETWORK_PROXY_API = '/api/network-proxy';

const globalHttpProxyAgents = new Map<string, ProxyAgent>();

export function globalHttpProxyUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.SHIRO_PROXY_URL?.trim() ||
    env.HTTPS_PROXY?.trim() ||
    env.HTTP_PROXY?.trim() ||
    DEFAULT_GLOBAL_PROXY_URL
  );
}

/**
 * The application-wide outbound relay. Webviews cannot perform arbitrary
 * cross-origin requests, so external traffic is posted here instead.
 */
export function networkProxyApi() {
  const configure = (server: MiddlewareHost) => {
    server.middlewares.use(async (request, response, next) => {
      if (apiPathOf(request) !== NETWORK_PROXY_API) {
        next();
        return;
      }
      if (request.method === 'GET') {
        sendJson(response, 200, {
          ok: true,
          proxy: globalHttpProxyUrl(),
          usage: 'Global HTTP proxy is ready. External application requests are sent here with POST.'
        });
        return;
      }
      if (request.method !== 'POST') {
        sendJson(response, 405, {
          error: 'Global HTTP proxy only supports GET health checks and POST requests'
        });
        return;
      }

      try {
        const body = JSON.parse(
          Buffer.concat(await collect(request)).toString('utf8')
        ) as Partial<GlobalProxyRequest>;
        if (!isValidProxyUrl(body.url) || !body.method) {
          sendJson(response, 400, { error: 'Invalid global proxy request' });
          return;
        }

        const proxyUrl =
          body.useProxy === true ? normalizeProxyUrl(body.proxyUrl) ?? globalHttpProxyUrl() : undefined;
        const upstream = await undiciFetch(body.url, {
          method: body.method,
          headers: sanitizeProxyRequestHeaders(body.headers),
          body: body.bodyBase64 ? Buffer.from(body.bodyBase64, 'base64') : undefined,
          dispatcher: proxyUrl ? getGlobalHttpProxyAgent(proxyUrl) : undefined
        });

        response.statusCode = upstream.status;
        copyProxyResponseHeaders(upstream.headers, response);
        response.flushHeaders?.();
        if (upstream.body) {
          const reader = upstream.body.getReader();
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            response.write(Buffer.from(value));
          }
        }
        response.end();
      } catch (error) {
        if (!response.headersSent) {
          sendJson(response, 502, { error: formatProxyError(error) });
        } else {
          response.end();
        }
      }
    });
  };

  return {
    name: 'global-http-proxy',
    configureServer: configure,
    configurePreviewServer: configure
  };
}

export function getGlobalHttpProxyAgent(proxyUrl: string): ProxyAgent {
  const existing = globalHttpProxyAgents.get(proxyUrl);
  if (existing) return existing;
  const agent = new ProxyAgent(proxyUrl);
  globalHttpProxyAgents.set(proxyUrl, agent);
  return agent;
}

interface GlobalProxyRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyBase64?: string;
  useProxy?: boolean;
  proxyUrl?: string;
}

async function collect(request: AsyncIterable<Buffer>): Promise<Buffer[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks;
}

function normalizeProxyUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function isValidProxyUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function sanitizeProxyRequestHeaders(headers: unknown): Record<string, string> {
  if (!isRecord(headers)) return {};
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([key, value]) => typeof value === 'string' && !isHopByHopHeader(key))
      .map(([key, value]) => [key, value as string])
  );
}

function copyProxyResponseHeaders(
  headers: { forEach(callback: (value: string, key: string) => void): void },
  response: import('node:http').ServerResponse
): void {
  headers.forEach((value, key) => {
    if (!isHopByHopHeader(key) && key !== 'content-encoding' && key !== 'content-length') {
      response.setHeader(key, value);
    }
  });
  response.setHeader('Cache-Control', 'no-cache');
}

function isHopByHopHeader(header: string): boolean {
  return [
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'host'
  ].includes(header.toLowerCase());
}

function formatProxyError(error: unknown): string {
  if (!(error instanceof Error)) return 'Global HTTP proxy request failed';
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : '';
  return `${error.message}${cause}`;
}
