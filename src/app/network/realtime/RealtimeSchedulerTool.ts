import type { SchedulerToolInput, ToolResultEvent } from '../../../scheduler/SchedulerTypes';
import { RealtimeGatewayClient } from './RealtimeGatewayClient';
import { parseDesktopRealtimeSyncEvent } from './DesktopRealtimeSync';

const SCHEDULER_TIMEOUT_MS = 12_000;

export async function requestRealtimeSchedulerTool(
  client: RealtimeGatewayClient,
  input: SchedulerToolInput,
  signal?: AbortSignal
): Promise<ToolResultEvent> {
  signal?.throwIfAborted();
  await waitUntilConnected(client, signal);
  const requestId = createId('scheduler');

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout = 0;
    let offResult: () => void = () => undefined;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      offResult();
      signal?.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')));
    offResult = client.on('desktop.sync', (payload) => {
      const event = parseDesktopRealtimeSyncEvent(payload);
      if (event?.type !== 'tool-result' || event.tool !== 'scheduler' || event.requestId !== requestId) return;
      finish(() => resolve(event));
    });
    timeout = window.setTimeout(
      () => finish(() => reject(new Error('桌宠定时服务响应超时，请确认 pages/desktop.html 已启动。'))),
      SCHEDULER_TIMEOUT_MS
    );
    signal?.addEventListener('abort', onAbort, { once: true });
    if (!client.sendCommand('desktop.sync', 'publish', { type: 'scheduler-command', requestId, input })) {
      finish(() => reject(new Error('WebSocket 推送连接尚未就绪。')));
    }
  });
}

function waitUntilConnected(client: RealtimeGatewayClient, signal?: AbortSignal): Promise<void> {
  if (client.getState() === 'connected') return Promise.resolve();
  client.connect();
  return new Promise((resolve, reject) => {
    let timeout = 0;
    let offReady: () => void = () => undefined;
    const finish = (callback: () => void) => {
      window.clearTimeout(timeout);
      offReady();
      signal?.removeEventListener('abort', onAbort);
      callback();
    };
    timeout = window.setTimeout(() => finish(() => reject(new Error('无法连接后台 WebSocket 服务。'))), 8_000);
    offReady = client.onReady(() => finish(resolve));
    const onAbort = () => finish(() => reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function createId(prefix: string): string {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${suffix}`;
}
