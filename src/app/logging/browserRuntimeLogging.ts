import { backendFetch } from '../network/backendFetch.ts';
import type { ActivityLogInput } from './ActivityLog';

export function installBrowserRuntimeLogging(): void {
  window.addEventListener('error', (event) => {
    record({
      channel: 'runtime',
      status: 'error',
      message: '浏览器未处理异常',
      details: { message: event.message, filename: event.filename, line: event.lineno, column: event.colno }
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    record({
      channel: 'runtime',
      status: 'error',
      message: '浏览器未处理 Promise 拒绝',
      details: { reason: serializeError(event.reason) }
    });
  });
}

function record(event: ActivityLogInput): void {
  // Crash reports must survive a not-yet-resolved backend port, so wait for the
  // API base before choosing the URL rather than posting to the page origin.
  void backendFetch('/api/activity-logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
    keepalive: true
  }).catch(() => undefined);
}

function serializeError(value: unknown): unknown {
  return value instanceof Error
    ? { name: value.name, message: value.message, stack: value.stack }
    : String(value);
}
