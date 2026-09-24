import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ActivityLog, ActivityLogInput } from '../../logging/ActivityLog';

const ACTIVITY_LOG_API = '/api/activity-logs';

export function activityLogApi(log: ActivityLog) {
  const configure = (server: {
    middlewares: {
      use(handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void): void;
    };
  }) => {
    server.middlewares.use((request, response, next) => {
      if (request.url?.split('?')[0] !== ACTIVITY_LOG_API) return next();
      void handle(request, response, log);
    });
  };
  return { name: 'activity-log-api', configureServer: configure, configurePreviewServer: configure };
}

/**
 * Records process-level failures and detects an unclean previous exit.
 *
 * `dataRoot` is the writable root: the marker must never be resolved against the
 * working directory, which is a read-only resource directory once packaged.
 */
export function installNodeRuntimeLogging(log: ActivityLog, dataRoot = '.'): void {
  const markerPath = path.resolve(dataRoot, '.local/runtime-session.json');
  if (existsSync(markerPath)) {
    let previous: unknown = {};
    try {
      previous = JSON.parse(readFileSync(markerPath, 'utf8'));
    } catch {
      previous = { unreadable: true };
    }
    log.record({
      channel: 'runtime',
      status: 'error',
      message: '检测到上次服务意外退出',
      details: { previous }
    });
  }
  mkdirSync(path.dirname(markerPath), { recursive: true });
  writeFileSync(
    markerPath,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    'utf8'
  );
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    log.record({
      channel: 'runtime',
      status: 'error',
      message: 'Node 未捕获异常',
      details: { origin, name: error.name, message: error.message, stack: error.stack }
    });
  });
  process.on('warning', (warning) => {
    log.record({
      channel: 'runtime',
      status: 'info',
      message: `Node 警告 · ${warning.name}`,
      details: { message: warning.message, stack: warning.stack }
    });
  });
  process.on('exit', (code) => {
    if (code === 0) {
      try {
        unlinkSync(markerPath);
      } catch {
        /* already removed */
      }
    }
  });
}

async function handle(request: IncomingMessage, response: ServerResponse, log: ActivityLog): Promise<void> {
  try {
    if (request.method === 'GET') {
      const day = new URL(request.url ?? '', 'http://localhost').searchParams.get('day') ?? undefined;
      sendJson(response, 200, { events: await log.list(day) });
      return;
    }
    if (request.method === 'POST') {
      log.record(JSON.parse(await readBody(request)) as ActivityLogInput);
      sendJson(response, 202, { accepted: true });
      return;
    }
    sendJson(response, 405, { error: 'Activity logs only support GET and POST' });
  } catch (error) {
    sendJson(response, 503, { error: error instanceof Error ? error.message : 'Activity log unavailable' });
  }
}

async function readBody(request: AsyncIterable<Buffer>): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 200_000) throw new Error('Activity log request is too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(value));
}
