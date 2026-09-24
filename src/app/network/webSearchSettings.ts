import { backendFetch } from './backendFetch.ts';

const WEB_SEARCH_SETTINGS_API = '/api/web-search-settings';

export async function loadWebSearchEnabled(fallback: boolean): Promise<boolean> {
  try {
    const response = await backendFetch(WEB_SEARCH_SETTINGS_API);
    if (!response.ok) return fallback;
    const body = (await response.json()) as { enabled?: unknown };
    return typeof body.enabled === 'boolean' ? body.enabled : fallback;
  } catch {
    return fallback;
  }
}

export async function saveWebSearchEnabled(enabled: boolean): Promise<boolean> {
  const response = await backendFetch(WEB_SEARCH_SETTINGS_API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled })
  });
  if (!response.ok) throw new Error(`联网搜索设置保存失败 (${response.status})`);
  const body = (await response.json()) as { enabled?: unknown };
  if (typeof body.enabled !== 'boolean') throw new Error('联网搜索设置接口返回无效数据。');
  return body.enabled;
}
