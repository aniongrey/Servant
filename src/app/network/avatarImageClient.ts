import { backendFetch } from './backendFetch';
import { resolveApiUrl } from './apiBase';

const CUSTOM_AVATAR_PREFIX = 'custom:';
const AVATAR_ID = /^([a-f0-9]{64})\.(png|jpg|webp)$/;

export async function uploadAvatarImage(image: Blob): Promise<string> {
  const response = await backendFetch('/api/avatars', {
    method: 'POST',
    headers: { 'Content-Type': image.type },
    body: image
  });
  const result: unknown = await response.json();
  if (!response.ok || !result || typeof result !== 'object' || !('id' in result) || typeof result.id !== 'string' || !AVATAR_ID.test(result.id))
    throw new Error(result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : '头像保存失败');
  return `${CUSTOM_AVATAR_PREFIX}${result.id}`;
}

export function avatarImageSource(avatarId: string, fallback: string): string {
  if (!avatarId.startsWith(CUSTOM_AVATAR_PREFIX)) return fallback;
  const assetId = avatarId.slice(CUSTOM_AVATAR_PREFIX.length);
  return AVATAR_ID.test(assetId) ? resolveApiUrl(`/api/avatars/${assetId}`) : fallback;
}
