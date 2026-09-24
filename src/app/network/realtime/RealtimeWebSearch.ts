import { type WebSearchResult } from '../../../ai/llm/LlmTools';
import { RealtimeGatewayClient } from './RealtimeGatewayClient';
import { isRecord } from './RealtimeProtocol';
import { loadUiPreferences } from '../../settings/uiPreferences';
import { parseDesktopRealtimeSyncEvent } from './DesktopRealtimeSync';

const WEB_SEARCH_TIMEOUT_MS = 45_000;

export interface WebSearchPushPayload {
  type: 'websearch';
  jobId: string;
  query: string;
  results: WebSearchResult[];
}

export async function requestRealtimeWebSearch(
  client: RealtimeGatewayClient,
  query: string,
  signal?: AbortSignal
): Promise<WebSearchPushPayload> {
  signal?.throwIfAborted();
  await waitUntilConnected(client, signal);
  const jobId = createId('websearch');
  const requestId = createId('run');

  return new Promise<WebSearchPushPayload>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      offPush();
      offMessage();
      signal?.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')));
    const offPush = client.on('desktop.sync', (payload) => {
      const event = parseDesktopRealtimeSyncEvent(payload);
      if (!event || event.type !== 'tool-result' || event.tool !== 'web-search' || event.requestId !== jobId) {
        return;
      }
      if (!event.success) {
        finish(() => reject(new Error(event.error || '后台联网搜索失败。')));
        return;
      }
      const content = parseWebSearchContent(event.content);
      if (!content) {
        finish(() => reject(new Error('后台返回了无效的联网搜索结果。')));
        return;
      }
      finish(() => resolve({ type: 'websearch', jobId, ...content }));
    });
    const offMessage = client.onMessage((message) => {
      if (message.type === 'error' && message.requestId === requestId) {
        finish(() => reject(new Error(message.message)));
      }
    });
    const timeout = window.setTimeout(
      () => finish(() => reject(new Error('后台联网搜索响应超时。'))),
      WEB_SEARCH_TIMEOUT_MS
    );
    signal?.addEventListener('abort', onAbort, { once: true });
    const preferences = loadUiPreferences();
    const proxyUrl = preferences.proxyEnabled ? preferences.proxyUrl.trim() : undefined;
    if (!client.sendCommand('web.search', 'run', { jobId, query, maxResults: 5, proxyUrl }, requestId)) {
      finish(() => reject(new Error('WebSocket 推送连接尚未就绪。')));
    }
  });
}

function parseWebSearchContent(value: unknown): Pick<WebSearchPushPayload, 'query' | 'results'> | undefined {
  if (!isRecord(value) || typeof value.query !== 'string' || !Array.isArray(value.results)) return undefined;
  const results = value.results.filter(isWebSearchResult).slice(0, 8);
  return results.length > 0 ? { query: value.query, results } : undefined;
}

function isWebSearchResult(value: unknown): value is WebSearchResult {
  return (
    isRecord(value) &&
    typeof value.title === 'string' &&
    typeof value.url === 'string' &&
    /^https?:\/\//i.test(value.url) &&
    typeof value.snippet === 'string' &&
    (value.content === undefined || typeof value.content === 'string')
  );
}

function waitUntilConnected(client: RealtimeGatewayClient, signal?: AbortSignal): Promise<void> {
  if (client.getState() === 'connected') return Promise.resolve();
  client.connect();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => finish(() => reject(new Error('无法连接后台 WebSocket 推送服务。'))),
      8_000
    );
    const offReady = client.onReady(() => finish(resolve));
    const onAbort = () => finish(() => reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')));
    const finish = (callback: () => void) => {
      window.clearTimeout(timeout);
      offReady();
      signal?.removeEventListener('abort', onAbort);
      callback();
    };
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
