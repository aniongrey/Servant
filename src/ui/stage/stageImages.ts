import { backendFetch } from '../../app/network/backendFetch';
import { readStageStorage, STAGE_IMAGES_KEY, validBackground } from './stageScene';

export interface StageImage { id: string; name: string }
export function loadStageImages(): StageImage[] {
  const value = readStageStorage(STAGE_IMAGES_KEY);
  return Array.isArray(value) ? value.filter((item): item is StageImage =>
    item && validBackground(item.id) && item.id.startsWith('custom:') && typeof item.name === 'string') : [];
}
export async function uploadStageImage(file: File): Promise<StageImage> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024)
    throw new Error('请选择 20 MB 以内的 PNG、JPEG 或 WebP 图片。');
  const bitmap = await createImageBitmap(file);
  const pixels = bitmap.width * bitmap.height;
  bitmap.close();
  if (pixels > 40_000_000) throw new Error('图片超过 4000 万像素，请缩小后上传。');
  const response = await backendFetch('/api/stage-backgrounds', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
  const result = await response.json();
  if (!response.ok || !validBackground(`custom:${result.id}`)) throw new Error(result.error ?? '背景保存失败');
  return { id: `custom:${result.id}`, name: file.name.slice(0, 80) };
}
