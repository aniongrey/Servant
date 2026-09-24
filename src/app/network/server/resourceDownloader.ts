import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from 'undici';

/**
 * The subset of `fetch` this module relies on. Injecting it lets tests run a
 * whole download against a local HTTP server without touching the network, and
 * keeps the proxy-aware undici implementation as the production default.
 */
export type FetchLike = typeof globalThis.fetch;

export interface ResourceDownloadOptions {
  /** Called with cumulative bytes received and the total (0 when unknown). */
  onProgress?: (receivedBytes: number, totalBytes: number) => void;
  /**
   * Override the proxy url. Defaults to the proxy configured via the
   * `SERVANT_PROXY_URL` / `HTTPS_PROXY` / `HTTP_PROXY` environment variables.
   * Pass `null` to force a direct connection.
   */
  proxyUrl?: string | null;
  /** Extra request headers (e.g. a User-Agent some hosts require). */
  headers?: Record<string, string>;
  /** Abort the in-flight download. */
  signal?: AbortSignal;
  /** Override the HTTP stack. Defaults to proxy-aware undici. */
  fetchImpl?: FetchLike;
}

const proxyAgents = new Map<string, ProxyAgent>();

function explicitProxyFromEnv(): string | undefined {
  return (
    process.env.SERVANT_PROXY_URL?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    undefined
  );
}

function proxyDispatcher(url: string | undefined): Dispatcher | undefined {
  if (!url) return undefined;
  const existing = proxyAgents.get(url);
  if (existing) return existing;
  const agent = new ProxyAgent(url);
  proxyAgents.set(url, agent);
  return agent;
}

export const DOWNLOAD_USER_AGENT = 'Servant-Provisioning/1.0';

/** Proxy dispatcher for undici, or `undefined` when going direct. */
export function resolveProxyDispatcher(proxyUrl?: string | null): Dispatcher | undefined {
  const proxy = proxyUrl === null ? undefined : proxyUrl ?? explicitProxyFromEnv();
  return proxyDispatcher(proxy);
}

/**
 * Streams `url` to `destination` (an absolute path), reporting progress and
 * writing atomically via a `.download` temp file that is renamed on success.
 *
 * Pure I/O with no `ProjectPaths` dependency so it can be exercised directly in
 * tests with a local HTTP server. Returns the number of bytes written.
 */
export async function downloadResourceToFile(
  url: string,
  destination: string,
  options: ResourceDownloadOptions = {}
): Promise<number> {
  const injected = options.fetchImpl;
  const doFetch: FetchLike = injected ?? (undiciFetch as unknown as FetchLike);
  const init: Parameters<FetchLike>[1] = {
    method: 'GET',
    redirect: 'follow',
    headers: { 'user-agent': DOWNLOAD_USER_AGENT, ...(options.headers ?? {}) },
    signal: options.signal
  };
  if (!injected) {
    (init as { dispatcher?: Dispatcher }).dispatcher = resolveProxyDispatcher(options.proxyUrl);
  }

  const upstream = await doFetch(url, init);

  if (!upstream.ok || !upstream.body) {
    const detail = upstream.status === 404 ? ' (404 Not Found)' : '';
    throw new Error(`资源下载失败：HTTP ${upstream.status}${detail} — ${url}`);
  }

  const totalBytes = Number(upstream.headers.get('content-length') ?? 0);
  const tempPath = `${destination}.download`;
  await mkdir(dirname(destination), { recursive: true });

  // Stream straight to disk: model weights run to multiple GB and must never be
  // buffered in the sidecar's memory.
  const handle = await open(tempPath, 'w');
  let received = 0;
  try {
    const reader = upstream.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const buffer = Buffer.from(value as Uint8Array);
      received += buffer.length;
      await handle.write(buffer);
      options.onProgress?.(received, totalBytes);
    }
  } catch (error) {
    await handle.close();
    await rm(tempPath, { force: true });
    throw error;
  }
  await handle.close();

  await rename(tempPath, destination);
  return received;
}

/** True when `relative` already exists under `base` (used to skip re-downloads). */
export async function fileExistsAt(base: string, relative: string): Promise<boolean> {
  return (await fileSizeAt(base, relative)) !== null;
}

/**
 * Size in bytes of `base/relative`, or `null` when it is absent or a directory.
 * Used to skip files that are already fully downloaded.
 */
export async function fileSizeAt(base: string, relative: string): Promise<number | null> {
  try {
    const info = await stat(joinPath(base, relative));
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

function joinPath(base: string, relative: string): string {
  return base.endsWith('/') || base.endsWith('\\') ? `${base}${relative}` : `${base}/${relative}`;
}
