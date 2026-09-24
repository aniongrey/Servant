/**
 * The single source of truth for where the Python memory service listens.
 *
 * Development defaults to 5175. The packaged sidecar allocates a free port at
 * startup and calls {@link setMemoryServicePort} before serving traffic, so no
 * build of the app depends on a fixed port being available.
 */
export const DEFAULT_MEMORY_SERVICE_PORT = 5175;

function readEnvPort(): number {
  const raw = process.env.SERVANT_MEMORY_PORT?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535
    ? parsed
    : DEFAULT_MEMORY_SERVICE_PORT;
}

let port = readEnvPort();

export function memoryServicePort(): number {
  return port;
}

export function setMemoryServicePort(next: number): void {
  if (!Number.isInteger(next) || next <= 0 || next > 65_535) {
    throw new Error(`Invalid memory service port: ${next}`);
  }
  port = next;
}

/** Origin plus the `/api/memory` prefix, e.g. `http://127.0.0.1:5175/api/memory`. */
export function memoryServiceBaseUrl(): string {
  return `http://127.0.0.1:${port}/api/memory`;
}

/** Absolute URL of one memory service route, e.g. `/messages?limit=8`. */
export function memoryServiceUrl(path: string): string {
  return `${memoryServiceBaseUrl()}${path}`;
}
