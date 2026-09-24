import { getApiBaseUrl, resolveApiUrl } from './apiBase.ts';

const GLOBAL_NETWORK_PROXY_API = '/api/network-proxy';

export interface GlobalNetworkFetchOptions {
  proxyEnabled: boolean;
  proxyUrl?: string;
}

type Routing = { local: true; target: RequestInfo | URL } | { local: false };

/**
 * Creates the application-wide HTTP transport.
 *
 * Requests for the Servant backend are sent directly; everything else is relayed
 * by the backend's `/api/network-proxy` route so the webview never performs a
 * cross-origin request itself.
 *
 * Which URLs count as "the Servant backend" depends on the runtime:
 *
 * - Development: the page origin also serves `/api/*`, so any page-relative URL
 *   is local. Behaviour is unchanged from before the backend became a sidecar.
 * - Packaged: the backend is a separate process on a random loopback port. A
 *   relative `/api/*` URL would resolve against `tauri://localhost` and return
 *   the SPA's HTML instead of JSON, so `/api/*` is rewritten onto the backend
 *   base — including URLs an AI SDK provider already resolved against the page
 *   origin.
 */
export function createGlobalNetworkFetch(options: GlobalNetworkFetchOptions): typeof globalThis.fetch {
  return async (input, init) => {
    const routing = route(input);
    if (routing.local) return fetch(routing.target, init);

    const request = new Request(input, init);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const method = request.method.toUpperCase();
    const bodyBase64 =
      method === 'GET' || method === 'HEAD' ? undefined : arrayBufferToBase64(await request.arrayBuffer());

    return fetch(resolveApiUrl(GLOBAL_NETWORK_PROXY_API), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: request.url,
        method,
        headers,
        bodyBase64,
        useProxy: options.proxyEnabled,
        proxyUrl: options.proxyUrl
      }),
      signal: init?.signal
    });
  };
}

function route(input: RequestInfo | URL): Routing {
  const raw = input instanceof Request ? input.url : input.toString();
  const base = getApiBaseUrl();
  const isRelative = /^(?:[/?#]|\.\.?\/)/.test(raw);

  if (base) {
    if (isRelative) return { local: true, target: new URL(raw, base).toString() };
    const url = parseUrl(raw);
    if (!url) return { local: false };
    // The backend owns every /api/* path, whichever origin the caller assumed.
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return { local: true, target: new URL(`${url.pathname}${url.search}`, base).toString() };
    }
    return url.origin === new URL(base).origin
      ? { local: true, target: url.toString() }
      : { local: false };
  }

  if (isRelative) return { local: true, target: input };
  const url = parseUrl(raw);
  if (!url) return { local: false };
  const isSameOriginPage = typeof location !== 'undefined' && url.origin === location.origin;
  return isSameOriginPage ? { local: true, target: url.toString() } : { local: false };
}

function parseUrl(raw: string): URL | undefined {
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
}
