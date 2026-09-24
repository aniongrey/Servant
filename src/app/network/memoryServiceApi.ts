import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MiddlewareHost } from './server/httpMiddleware.ts';
import { apiPathOf, sendJson } from './server/httpMiddleware.ts';
import {
  memoryServiceBaseUrl,
  memoryServicePort,
  setMemoryServicePort
} from './server/memoryServiceAddress.ts';
import {
  fetchMemory,
  prewarmMemoryService,
  registerMemoryServiceLifecycle
} from './server/memoryServiceClient.ts';
import { resolveProjectPaths, type ProjectPaths } from './server/projectPaths.ts';
import { getResourceEntry } from './server/resourceManifest.ts';
import { directoryExists, resourceRoots } from './server/provisioningStore.ts';
import { readSharedModelRoots } from './server/sharedModelRoots.ts';
import { MEMORY_MODEL_RESOURCE_ID } from '../provisioning/provisioningTypes.ts';

const API_PREFIX = '/api/memory';
const MEMORY_SERVICE_SCRIPT = 'memory_service/servant_memory.py';
const MEMORY_SERVICE_DATABASE = '.local/memory.lancedb';

export interface MemoryServiceApiOptions {
  /**
   * Port for the Python service. `0` asks the operating system for a free port
   * (used by the packaged sidecar), a positive number pins it.
   */
  port?: number;
}

/**
 * Owns the Python memory service: spawns it, pins its port and proxies
 * `/api/memory/*` through the backend, so the webview never talks to it directly
 * and the port is free to differ between development and the packaged app.
 */
export function memoryServiceApi(
  paths: ProjectPaths = resolveProjectPaths(),
  options: MemoryServiceApiOptions = {}
) {
  if (options.port !== undefined && options.port !== 0) setMemoryServicePort(options.port);

  let handle: ChildProcess | undefined;
  let spawnError: Error | undefined;

  const start = (): void => {
    if (handle && handle.exitCode === null) return;
    const script = path.resolve(paths.root, MEMORY_SERVICE_SCRIPT);
    if (!existsSync(script)) {
      spawnError = new Error(`记忆服务脚本缺失：${script}`);
      return;
    }
    spawnError = undefined;
    const python = resolvePython(paths);
    const child = spawn(python, [script], {
      cwd: paths.data,
      env: {
        ...process.env,
        SERVANT_MEMORY_PORT: String(memoryServicePort()),
        SERVANT_MEMORY_PATH: path.resolve(paths.data, MEMORY_SERVICE_DATABASE),
        // The embedding model is downloaded to the user's chosen directory, so
        // the service can no longer find it by its old data-relative default.
        // Resolved through the same helper the downloader and the asset route
        // use, which keeps "where the model is" a single answer.
        ...embeddingModelEnv(paths)
      },
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true
    });
    handle = child;
    child.once('error', (error) => {
      spawnError = new Error(`无法启动 ${python}：${error.message}`);
      console.error('Memory service failed to start:', error.message);
    });
    // The usual failure is an interpreter that exists but lacks the
    // dependencies: it starts, imports, and dies immediately. Left alone, the
    // only symptom is a refused connection a moment later, which reads like a
    // network problem and sends the reader looking in the wrong place.
    child.once('exit', (code, signal) => {
      if (handle !== child) return; // replaced or stopped on purpose
      if (code === 0) return;
      spawnError = new Error(
        `记忆服务进程退出（code=${code} signal=${signal}）：${python} 缺少 memory_service/requirements.txt 中的依赖`
      );
    });
  };

  const stop = (): void => {
    handle?.kill();
    handle = undefined;
  };

  // Hand the client the two facts only the spawner knows: that a start is worth
  // attempting, and why the last one died. Without the second, a missing
  // dependency reads as an endless warm-up instead of a named failure.
  registerMemoryServiceLifecycle({
    start: () => {
      if (!process.env.VITEST) start();
    },
    spawnError: () => spawnError
  });

  const configure = (server: MiddlewareHost) => {
    if (process.env.VITEST) return;
    start();
    // Spawned above, warmed here: the two halves of a cold start. Leaving the
    // second half to the first request is what made startup look slow — the
    // model load was already running in the Python process, but nobody was
    // waiting on it or saying when it finished.
    prewarmMemoryService();
    server.httpServer?.once('close', stop);
    server.middlewares.use((request, response, next) => {
      if (!apiPathOf(request).startsWith(API_PREFIX)) {
        next();
        return;
      }
      start();
      void proxy(request, response, () => spawnError);
    });
  };

  return {
    name: 'memory-service-api',
    configureServer: configure,
    configurePreviewServer: configure,
    stop
  };
}

/**
 * Interpreter for the memory service.
 *
 * Order matters. `SERVANT_PYTHON` wins first, so a wrong guess is always
 * overridable. Then the checkout's `.venv-memory` — in development that is the
 * environment `README.md` tells you to create, and reusing it is the reason it
 * exists. Then the same directory under the writable data root, which is where a
 * packaged install can keep its own interpreter: that directory is not touched
 * by a rebuild or by installing over an older version, so one
 * `pip install -r requirements.txt` there survives both.
 *
 * `python` on PATH is the last resort — correct on a machine that installed the
 * dependencies globally, and the most common reason the memory service is
 * unavailable when it is not.
 */
const MEMORY_VENV_DIRECTORY = '.venv-memory';

export function pythonCandidates(paths: ProjectPaths): string[] {
  const override = process.env.SERVANT_PYTHON?.trim();
  const fromVenv = [paths.root, paths.data].flatMap((base) =>
    ['Scripts/python.exe', 'bin/python'].map((relative) =>
      path.resolve(base, MEMORY_VENV_DIRECTORY, relative)
    )
  );
  return [...(override ? [override] : []), ...fromVenv, 'python'];
}

function resolvePython(paths: ProjectPaths): string {
  for (const candidate of pythonCandidates(paths)) {
    if (candidate === 'python' || existsSync(candidate)) return candidate;
  }
  return 'python';
}

/**
 * Points the Python service at the downloaded embedding model.
 *
 * `servant_memory.py` falls back to a data-relative `.local/models/...` and then to
 * a 1.2GB HuggingFace download, so it must be told where the model actually is —
 * and silently falling back is the worst outcome, because it looks like nothing
 * is wrong while the user's chosen directory is ignored.
 *
 * The first root that exists wins: that is the download root when the model has
 * been fetched, and the pre-existing data-directory copy otherwise, so a machine
 * that already has the model keeps working without re-downloading it.
 */
function embeddingModelEnv(paths: ProjectPaths): Record<string, string> {
  const entry = getResourceEntry(MEMORY_MODEL_RESOURCE_ID);
  if (!entry) return {};
  // Shared roots last: the chosen directory wins, then the build-local mirrors,
  // then whatever another Servant build on this machine downloaded
  // (`sharedModelRoots.ts`).
  const roots = resourceRoots(paths, entry, undefined, readSharedModelRoots());
  const directory = roots.find((candidate) => directoryExists(candidate)) ?? roots[0];
  return directory ? { SERVANT_EMBEDDING_MODEL: directory } : {};
}

async function proxy(
  request: IncomingMessage,
  response: ServerResponse,
  readSpawnError: () => Error | undefined
): Promise<void> {
  try {
    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await readBody(request);
    const upstream = await fetchMemory(`${memoryServiceBaseUrl()}${routeSuffix(request.url)}`, {
      method: request.method,
      headers: {
        'content-type': request.headers['content-type'] ?? 'application/json',
        'x-servant-memory': '1'
      },
      body: body ? new Uint8Array(body) : undefined
    });
    response.statusCode = upstream.status;
    response.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    // The most common failure is a Python that was never installed; surface the
    // spawn reason instead of a bare connection refusal.
    const spawnError = readSpawnError();
    sendJson(response, 503, {
      error:
        error instanceof Error
          ? `记忆服务不可用：${spawnError?.message ?? error.message}`
          : '记忆服务不可用，请安装 memory_service/requirements.txt'
    });
  }
}

/** `/api/memory/messages?limit=8` -> `/messages?limit=8` */
function routeSuffix(url: string | undefined): string {
  const raw = url ?? API_PREFIX;
  const queryIndex = raw.indexOf('?');
  const route = queryIndex >= 0 ? raw.slice(0, queryIndex) : raw;
  const query = queryIndex >= 0 ? raw.slice(queryIndex) : '';
  return `${route.slice(API_PREFIX.length)}${query}`;
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 1_000_000) throw new Error('Memory request exceeds size limit');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
