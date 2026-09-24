import { ensureApiBase, resolveApiUrl } from './apiBase.ts';

/**
 * `fetch` for Servant's own backend routes.
 *
 * Every frontend call to `/api/*` must go through here. Once packaged the
 * backend is a separate process on a random loopback port, and the page origin
 * (`tauri.localhost`) belongs to Tauri's asset protocol: a page-relative
 * `/api/*` URL is answered with the SPA's `index.html`, so `response.json()`
 * dies with `Unexpected token '<'`. That failure mode is silent — it looks like
 * a hung "loading" state, not an error — which is exactly how the character
 * card ended up spinning forever on the chat page.
 *
 * Awaiting `ensureApiBase()` here (rather than trusting each entry point to
 * have done it) keeps the rule to one line at every call site, and makes it
 * correct on entry points that never triggered the handshake.
 *
 * Requests that must leave the machine (LLM providers, model downloads) belong
 * on `createGlobalNetworkFetch`, which additionally relays them through
 * `/api/network-proxy`.
 */
export async function backendFetch(path: string, init?: RequestInit): Promise<Response> {
  await ensureApiBase();
  return fetch(resolveApiUrl(path), init);
}
