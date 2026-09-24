import { createServer, type Server } from 'node:http';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { API_PATH_PREFIXES, createApiModules } from '../app/network/server/apiModules.ts';
import type { Middleware, MiddlewareHost } from '../app/network/server/httpMiddleware.ts';
import { createRequestListener } from './middlewareChain.ts';

/**
 * Standalone Shiro backend.
 *
 * Launched by Tauri as a sidecar (and by `npm run server:dev` for parity
 * testing). It listens on a loopback port the parent chooses — or a free one
 * when `SHIRO_SERVER_PORT=0` — announces itself on stdout, and shuts down when
 * the parent goes away.
 *
 * Every `/api/*` route is built from the same table the Vite dev server uses, so
 * "works in dev, broken in the installer" cannot happen by construction.
 */

const HOST = process.env.SHIRO_SERVER_HOST?.trim() || '127.0.0.1';
const READY_MARKER = 'SHIRO_SERVER_READY';
const SHUTDOWN_GRACE_MS = 1_500;

function parsePort(raw: string | undefined, fallback: number): number {
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65_535 ? parsed : fallback;
}

/** Asks the OS for a port the parent can trust is currently free. */
function reserveFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, HOST, () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function main(): Promise<void> {
  const requestedPort = parsePort(process.env.SHIRO_SERVER_PORT, 0);
  const requestedMemoryPort = parsePort(process.env.SHIRO_MEMORY_PORT, -1);
  // 0 means "pick a free port" for both services, so a second Shiro instance
  // never fights the first one for 5174/5175.
  const memoryServicePort = requestedMemoryPort === 0 ? await reserveFreePort() : undefined;

  const { modules, backend, stopMemoryService } = createApiModules({
    memoryServicePort,
    dedicatedRealtimePort: null,
    installRuntimeLogging: true
  });

  const middlewares: Middleware[] = [];
  const server: Server = createServer();
  const host: MiddlewareHost = {
    middlewares: { use: (handler) => middlewares.push(handler) },
    httpServer: server
  };
  for (const module of modules) {
    module.configureServer(host);
  }

  server.on('request', createRequestListener(middlewares, respondNotFound));

  const port = await listen(server, requestedPort);
  announce(port);
  installShutdown(server, stopMemoryService, backend);
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : port);
    });
  });
}

function respondNotFound(_request: unknown, response: import('node:http').ServerResponse): void {
  response.statusCode = 404;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(
    JSON.stringify({
      error: 'Unknown Shiro backend route',
      knownPrefixes: API_PATH_PREFIXES,
      hint: 'The Shiro backend serves /api/* only; the app UI is served by Tauri.'
    })
  );
}

/**
 * Announces the chosen ports on stdout. This is the handshake Tauri reads; it is
 * the only reliable channel because a random port cannot be known in advance.
 */
function announce(port: number): void {
  const info = { port, host: HOST, pid: process.pid };
  const portFile = process.env.SHIRO_SERVER_PORT_FILE?.trim();
  if (portFile) {
    try {
      mkdirSync(path.dirname(portFile), { recursive: true });
      writeFileSync(portFile, JSON.stringify(info), 'utf8');
    } catch (error) {
      console.error('[shiro-server] unable to write the port file:', error);
    }
  }
  console.log(`${READY_MARKER} ${JSON.stringify(info)}`);
}

function installShutdown(
  server: Server,
  stopMemoryService: () => void,
  backend: { orchestrator: { cancel(turnId?: string): boolean } }
): void {
  let stopping = false;
  const shutdown = (reason: string): void => {
    if (stopping) return;
    stopping = true;
    console.log(`[shiro-server] shutting down (${reason})`);
    // Abort in-flight turns so no LLM request outlives the window.
    backend.orchestrator.cancel();
    try {
      stopMemoryService();
    } catch {
      /* the child may already be gone */
    }
    const finish = (): void => {
      const portFile = process.env.SHIRO_SERVER_PORT_FILE?.trim();
      if (portFile) {
        try {
          rmSync(portFile, { force: true });
        } catch {
          /* best effort */
        }
      }
      process.exit(0);
    };
    server.close(finish);
    setTimeout(finish, SHUTDOWN_GRACE_MS).unref();
  };

  // The parent dying closes our stdin; that is what guarantees no orphan
  // backend survives a Tauri crash, even if the kill signal is never delivered.
  process.stdin.on('end', () => shutdown('stdin closed'));
  process.stdin.on('close', () => shutdown('stdin closed'));
  process.stdin.resume();
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (error) => {
    console.error('[shiro-server] uncaught exception:', error);
  });
}

void main().catch((error) => {
  console.error('[shiro-server] failed to start:', error);
  process.exit(1);
});
