import { normalizeCharacterRenderConfig } from '../../character/vrm/characterRenderSettings';
import type { CharacterRenderConfig } from '../../character/vrm/CharacterRenderConfig';
import { resolveApiUrl } from '../../app/network/apiBase';

export const STAGE_SCENE_KEY = 'servant.stageScene.v1';
export const STAGE_SAVES_KEY = 'servant.stageSaves.v1';
export const STAGE_IMAGES_KEY = 'servant.stageImages.v1';
export type StagePose = { x: number; y: number; zoom: number; z: number };
export type StageLayout = Record<string, StagePose>;
export type StageLight = Pick<CharacterRenderConfig, 'mainLightIntensity' | 'ambientLightIntensity'>;
export interface StageScene {
  background: string;
  fit: 'cover' | 'contain';
  backgroundX: number;
  backgroundY: number;
  brightness: number;
  blur: number;
  view: { zoom: number; x: number; y: number };
  layout: StageLayout;
  hidden: string[];
  lighting: StageLight | null;
  characterLighting: Record<string, CharacterRenderConfig>;
}
export interface SavedStage { id: string; name: string; scene: StageScene }
export const stageBackgrounds = [
  { id: 'classroom', name: '教室 · 黄昏', src: '/assets/scenes/教室-黄昏.png' },
  { id: 'bedroom', name: '卧室 · 黄昏', src: '/assets/scenes/卧室-黄昏.png' },
  { id: 'live', name: '直播舞台', src: '/assets/scenes/直播舞台.png' },
  { id: 'sakura', name: '樱花庭院', src: '/assets/backgrounds/sakura-settings-1080p.png' },
  { id: 'dawn', name: '远山晨光', src: '/assets/backgrounds/stage-dawn.svg' },
  { id: 'night', name: '城市夜色', src: '/assets/backgrounds/stage-night.svg' },
  { id: 'solid', name: '午夜纯色', src: '' },
  { id: 'transparent', name: '透明桌面', src: '' }
];
export const defaultStageScene: StageScene = {
  background: 'sakura', fit: 'cover', backgroundX: 50, backgroundY: 50,
  brightness: 0.85, blur: 0, view: { zoom: 1, x: 0, y: 0 }, layout: {},
  hidden: [], lighting: null, characterLighting: {}
};
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const bounded = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
export const validBackground = (id: unknown): id is string => typeof id === 'string' &&
  (stageBackgrounds.some((item) => item.id === id) || /^custom:[a-f0-9]{64}\.(png|jpg|webp)$/.test(id));
export function backgroundSource(id: string): string {
  if (!validBackground(id)) return '';
  return id.startsWith('custom:') ? resolveApiUrl(`/api/stage-backgrounds/${id.slice(7)}`)
    : stageBackgrounds.find((item) => item.id === id)?.src ?? '';
}
export function normalizeStageScene(value: unknown): StageScene {
  const data = record(value), view = record(data.view), light = record(data.lighting);
  return {
    background: validBackground(data.background) ? data.background : defaultStageScene.background,
    fit: data.fit === 'contain' ? 'contain' : 'cover',
    backgroundX: bounded(data.backgroundX, 50, 0, 100), backgroundY: bounded(data.backgroundY, 50, 0, 100),
    brightness: bounded(data.brightness, 0.85, 0.2, 1.5), blur: bounded(data.blur, 0, 0, 16),
    view: { zoom: bounded(view.zoom, 1, 0.5, 2), x: bounded(view.x, 0, -50, 50), y: bounded(view.y, 0, -50, 50) },
    layout: Object.fromEntries(Object.entries(record(data.layout)).map(([id, value]) => {
      const pose = record(value);
      return [id, { x: bounded(pose.x, 0, -20, 120), y: bounded(pose.y, 0, -30, 70),
        zoom: bounded(pose.zoom, 2, 0.3, 6), z: bounded(pose.z, 1, 0, 1000) }];
    })),
    hidden: Array.isArray(data.hidden) ? data.hidden.filter((id): id is string => typeof id === 'string') : [],
    lighting: data.lighting ? { mainLightIntensity: bounded(light.mainLightIntensity, 3, 0.5, 4), ambientLightIntensity: bounded(light.ambientLightIntensity, 0.92, 0, 1.4) } : null,
    characterLighting: Object.fromEntries(Object.entries(record(data.characterLighting)).map(([id, config]) => [id, normalizeCharacterRenderConfig(config)]))
  };
}
export function readStageStorage(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; }
}
export function loadStageScene(): StageScene {
  return normalizeStageScene(readStageStorage(STAGE_SCENE_KEY) ?? { layout: readStageStorage('servant.meetingStage.v1') });
}
export function loadSavedStages(): SavedStage[] {
  const data = readStageStorage(STAGE_SAVES_KEY);
  return Array.isArray(data) ? data.flatMap((item) => {
    const value = record(item);
    return typeof value.id === 'string' && typeof value.name === 'string'
      ? [{ id: value.id, name: value.name.slice(0, 60), scene: normalizeStageScene(value.scene) }] : [];
  }) : [];
}
export function actorLighting(scene: StageScene, id: string, base: CharacterRenderConfig): CharacterRenderConfig {
  return { ...base, ...scene.characterLighting[id], ...scene.lighting };
}
