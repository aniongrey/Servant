/**
 * The one place the frontend learns where the Servant backend lives.
 *
 * Development: the page is served by the Vite dev server, which also serves
 * `/api/*`, so the base stays empty and every URL stays relative — exactly the
 * behaviour that existed before the backend became a sidecar.
 *
 * Packaged: the page is served from `tauri.localhost` while the backend is a
 * separate `servant-server` process on a random loopback port, so every `/api/*`
 * URL must be absolute. A relative URL there would hit the Tauri asset protocol
 * and return `index.html` instead of JSON — the bug this module exists to kill.
 */

export interface ServantServerInfo {
  /** `'sidecar'` when Tauri owns a backend process, `'external'` when the page origin serves it. */
  mode: 'sidecar' | 'external';
  port: number;
  baseUrl: string;
}

let baseUrl = '';
let resolved = false;
let pending: Promise<void> | undefined;

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Resolved backend origin, or `''` when `/api/*` is same-origin. */
export function getApiBaseUrl(): string {
  return baseUrl;
}

/**
 * Resolves the backend origin once per page. Safe to await repeatedly; a failed
 * attempt is retried by the next caller instead of being cached as broken.
 */
export function ensureApiBase(): Promise<void> {
  if (resolved) return Promise.resolve();
  pending ??= resolve().catch((error) => {
    pending = undefined;
    throw error;
  });
  return pending;
}

async function resolve(): Promise<void> {
  if (!isTauriRuntime()) {
    baseUrl = '';
    resolved = true;
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  const info = await invoke<ServantServerInfo>('servant_server_info');
  baseUrl = info.mode === 'sidecar' ? info.baseUrl : '';
  resolved = true;
}

/** Synchronous best-effort resolver for event handlers and render paths. */
export function resolveApiUrl(path: string): string {
  return baseUrl && path.startsWith('/') ? `${baseUrl}${path}` : path;
}

/** WebSocket URL of a backend route, or `undefined` when the page origin owns it. */
export function resolveApiWebSocketUrl(path: string): string | undefined {
  if (!baseUrl || !path.startsWith('/')) return undefined;
  return `ws${baseUrl.replace(/^http/, '')}${path}`;
}

if (isTauriRuntime()) {
  // Start the handshake while the first page is still booting so the base is
  // ready before the first user action needs it.
  void ensureApiBase().catch(() => undefined);
}
