import { publishDesktopRealtimeSync } from '../../app/network/realtime/DesktopRealtimeSync';
import { type DesktopCharacterSettings } from './characterSettings';
import { backendFetch } from '../../app/network/backendFetch';

const uploadedAssets = new Map<string, string>();

export async function publishDesktopCharacter(
  settings: DesktopCharacterSettings,
  imported: { id: string; blob: Blob } | null,
  signal: AbortSignal
): Promise<void> {
  let asset = imported ? uploadedAssets.get(imported.id) : undefined;
  if (imported && !asset) {
    const upload = await backendFetch('/api/desktop-character/models', {
      method: 'POST',
      body: imported.blob,
      signal,
      headers: { 'Content-Type': 'model/gltf-binary' }
    });
    if (!upload.ok) throw new Error(`共享模型上传失败 (${upload.status})`);
    asset = ((await upload.json()) as { asset: string }).asset;
    uploadedAssets.set(imported.id, asset);
  }
  signal.throwIfAborted();
  const response = await backendFetch('/api/desktop-character', {
    method: 'PUT',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...settings, model: { id: settings.model.id, ...(asset ? { asset } : {}) } })
  });
  if (!response.ok) throw new Error(`桌宠角色设置同步失败 (${response.status})`);
  publishDesktopRealtimeSync({ type: 'character-settings-changed' });
}
