import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';

/**
 * The connect-style middleware contract every API module speaks.
 *
 * Vite dev/preview servers and the standalone `servant-server` entry both
 * implement {@link MiddlewareHost}, so one API module serves the browser dev
 * server and the packaged sidecar without a second code path.
 */
export type NextFunction = (error?: unknown) => void;
export type Middleware = (request: IncomingMessage, response: ServerResponse, next: NextFunction) => void;

/** The subset of a Vite dev/preview server the API modules are allowed to rely on. */
export interface MiddlewareHost {
  middlewares: { use(handler: Middleware): void };
  /**
   * The host's HTTP server, when it has one. Required by the realtime gateway
   * (WebSocket upgrades) and the Doubao TTS socket relay.
   */
  httpServer?: HttpServer | null;
}

/** A mountable backend feature. Matches the shape Vite plugins already use. */
export interface ApiModule {
  name: string;
  configureServer(server: MiddlewareHost): void;
  configurePreviewServer?(server: MiddlewareHost): void;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readRequestBody(
  request: AsyncIterable<Buffer>,
  limitBytes: number
): Promise<Buffer> {
  return (async () => {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += buffer.length;
      if (length > limitBytes) throw new Error('Request body exceeds size limit');
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  })();
}

export async function readRequestText(
  request: AsyncIterable<Buffer>,
  limitBytes = 1_000_000
): Promise<string> {
  return (await readRequestBody(request, limitBytes)).toString('utf8');
}

export function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  headers?: Record<string, string>
): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  for (const [key, value] of Object.entries(headers ?? {})) response.setHeader(key, value);
  response.end(JSON.stringify(body));
}

/**
 * The local backend is a security boundary: only same-origin pages, the packed
 * Tauri webview and origin-less native callers may reach it.
 */
export function isAllowedLocalOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  return (
    !origin ||
    origin === `http://${request.headers.host}` ||
    origin === 'http://tauri.localhost' ||
    origin === 'tauri://localhost'
  );
}

/**
 * Answers CORS for allowed local origins. Returns true when the request has
 * already been fully handled (denied, or a preflight), so the caller can stop.
 */
export function applyLocalCors(
  request: IncomingMessage,
  response: ServerResponse,
  methods = 'GET, POST, PUT, DELETE, OPTIONS'
): boolean {
  if (!isAllowedLocalOrigin(request)) {
    response.statusCode = 403;
    response.end();
    return true;
  }
  if (request.headers.origin) {
    response.setHeader('Access-Control-Allow-Origin', request.headers.origin);
    response.setHeader('Vary', 'Origin');
  }
  if (request.method === 'OPTIONS') {
    response.setHeader('Access-Control-Allow-Methods', methods);
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.statusCode = 204;
    response.end();
    return true;
  }
  return false;
}

/** Route path of a request, with the query string stripped. */
export function apiPathOf(request: IncomingMessage): string {
  return request.url?.split('?')[0] ?? '';
}
