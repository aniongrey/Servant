import { backendFetch } from '../network/backendFetch.ts';
import { resolveApiUrl } from '../network/apiBase.ts';
import {
  createDefaultProvisioningState,
  normalizeModelSiteOrder,
  normalizeProvisioningState,
  provisioningAssetPath,
  PROVISIONING_API_PATH,
  type ModelSiteId,
  type ProvisioningState
} from './provisioningTypes.ts';
import type { ProvisioningDownloadEvent, ResourceStatusView } from '../network/server/provisioningApi.ts';

export async function getProvisioningState(): Promise<ProvisioningState> {
  try {
    const response = await backendFetch(`${PROVISIONING_API_PATH}/state`);
    if (!response.ok) return createDefaultProvisioningState();
    return normalizeProvisioningState(await response.json());
  } catch {
    return createDefaultProvisioningState();
  }
}

export async function saveProvisioningState(state: ProvisioningState): Promise<ProvisioningState> {
  const response = await backendFetch(`${PROVISIONING_API_PATH}/state`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(state)
  });
  if (!response.ok) throw new Error(`保存设置失败：${response.status}`);
  return normalizeProvisioningState(await response.json());
}

export interface ResourceReport {
  preparedResources: string[];
  /** Persisted download-site preference, in fallback order. */
  modelSites: ModelSiteId[];
  /** Raw persisted download directory (`''` when the user never chose one). */
  downloadRoot: string;
  /** Directory that would actually be used right now. */
  resolvedDownloadRoot: string;
  /** Directory used when the user has not chosen one. */
  defaultDownloadRoot: string;
  /** Roots other Servant builds published on this machine, newest first. */
  sharedRoots: string[];
  resources: ResourceStatusView[];
}

/**
 * Reads the per-resource report.
 *
 * `previewRoot` answers for an arbitrary directory without persisting anything —
 * the wizard passes the directory being typed, so pointing it at a folder that
 * already holds the models shows them as present instead of "待下载".
 */
export async function getResourceReport(previewRoot?: string): Promise<ResourceReport> {
  const query = previewRoot?.trim() ? `?downloadRoot=${encodeURIComponent(previewRoot.trim())}` : '';
  const response = await backendFetch(`${PROVISIONING_API_PATH}/resources${query}`);
  if (!response.ok) throw new Error(`读取资源状态失败：${response.status}`);
  const body = (await response.json()) as Partial<ResourceReport>;
  return {
    preparedResources: body.preparedResources ?? [],
    modelSites: normalizeModelSiteOrder(body.modelSites),
    downloadRoot: body.downloadRoot ?? '',
    resolvedDownloadRoot: body.resolvedDownloadRoot ?? '',
    defaultDownloadRoot: body.defaultDownloadRoot ?? '',
    sharedRoots: body.sharedRoots ?? [],
    resources: body.resources ?? []
  };
}

export interface DownloadResourcesRequest {
  resourceIds: string[];
  /** Overrides the persisted download-source preference for this run. */
  modelSites?: ModelSiteId[];
  /** Absolute directory to download into; omitted keeps the persisted choice. */
  downloadRoot?: string;
}

export interface DownloadResourcesResult {
  preparedResources: string[];
  /** Site that actually served each resource id. */
  sites: Partial<Record<string, ModelSiteId>>;
}

/**
 * Streams the download of the given resource ids, invoking `onEvent` for each
 * Server-Sent-Event emitted by the backend. Resolves once the `complete` event
 * arrives. A failed resource is reported via a `resource-error` event but does
 * not reject — the caller decides whether to abort.
 *
 * The backend still walks the whole site list, falling back automatically.
 */
export async function downloadResources(
  request: DownloadResourcesRequest,
  onEvent: (event: ProvisioningDownloadEvent) => void
): Promise<DownloadResourcesResult> {
  const response = await backendFetch(`${PROVISIONING_API_PATH}/download`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request)
  });
  if (!response.ok || !response.body) {
    throw new Error(`下载请求失败：${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed: DownloadResourcesResult = { preparedResources: [], sites: {} };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.split('\n').find((part) => part.startsWith('data:'));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let event: ProvisioningDownloadEvent;
      try {
        event = JSON.parse(payload) as ProvisioningDownloadEvent;
      } catch {
        continue;
      }
      onEvent(event);
      if (event.type === 'complete') {
        completed = { preparedResources: event.preparedResources, sites: event.sites };
      }
    }
  }

  return completed;
}

/**
 * Absolute URL of a file inside a provisioned resource directory.
 *
 * Absolute on purpose: the caller may be a Web Worker, which resolves a relative
 * URL against its own script location, and in the packaged app the page origin
 * belongs to Tauri's asset protocol rather than to the backend.
 */
export function provisioningAssetUrl(resourceId: string, filePath: string): string {
  return resolveApiUrl(provisioningAssetPath(resourceId, filePath));
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
