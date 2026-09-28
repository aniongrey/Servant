import { publishDesktopRealtimeSync } from '../../app/network/realtime/DesktopRealtimeSync';
import { type DesktopCharacterSettings } from './characterSettings';
import { backendFetch } from '../../app/network/backendFetch';
import { isModelArchive } from '../../character/vrm/modelArchive';

const uploadedAssets = new Map<string, string>();

export async function publishDesktopCharacter(
  settings: DesktopCharacterSettings,
  imported: { id: string; blob: Blob } | null,
  signal: AbortSignal
): Promise<void> {
  // The model endpoint only accepts GLB and hands models back as GLB, so a packed
  // MMD folder cannot travel that route — and does not need to: every window reads
  // the same local store, so publishing the model id alone reaches the bytes.
  const uploadable = imported && !isModelArchive(imported.blob) ? imported : null;
  let asset = uploadable ? uploadedAssets.get(uploadable.id) : undefined;
  if (uploadable && !asset) {
    const upload = await backendFetch('/api/desktop-character/models', {
      method: 'POST',
      body: uploadable.blob,
      signal,
      headers: { 'Content-Type': 'model/gltf-binary' }
    });
    if (!upload.ok) throw new Error(`共享模型上传失败 (${upload.status})`);
    asset = ((await upload.json()) as { asset: string }).asset;
    uploadedAssets.set(uploadable.id, asset);
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
