import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defaultCharacterRenderConfig } from '../../character/vrm/CharacterRenderConfig';
import { actorLighting, backgroundSource, defaultStageScene, normalizeStageScene, stageBackgrounds, validBackground } from './stageScene';
import { isStageMeetingCommand } from '../meeting/stageMeetingBridge';

describe('stage scenes', () => {
  it('resolves every bundled scene image to an existing public asset', () => {
    for (const background of stageBackgrounds.filter((item) => item.src)) {
      const source = backgroundSource(background.id);
      expect(existsSync(path.join(process.cwd(), 'public', source)), source).toBe(true);
    }
  });
  it('restores bounded geometry and rejects unsafe background URLs', () => {
    const scene = normalizeStageScene({ background: 'https://example.com/tracker.png', view: { zoom: 999, x: NaN, y: -900 },
      layout: { actor: { x: Infinity, y: 10, zoom: -5, z: 8 } }, hidden: ['actor', null], lighting: { mainLightIntensity: NaN } });
    expect(scene.background).toBe('sakura');
    expect(scene.view).toEqual({ zoom: 2, x: 0, y: -50 });
    expect(scene.layout.actor).toEqual({ x: 0, y: 10, zoom: 0.3, z: 8 });
    expect(scene.hidden).toEqual(['actor']);
    expect(scene.lighting).toEqual({ mainLightIntensity: 3, ambientLightIntensity: 0.92, forceUnlitLighting: false });
    expect(validBackground(`custom:${'a'.repeat(64)}.webp`)).toBe(true);
    expect(validBackground('custom:../secret')).toBe(false);
  });
  it('round-trips scenes and keeps actor appearance separate from stage lighting', () => {
    const scene = { ...defaultStageScene, background: 'night', lighting: { mainLightIntensity: 1, ambientLightIntensity: 0.3, forceUnlitLighting: true },
      characterLighting: { a: { ...defaultCharacterRenderConfig, rimStrength: 0.8, mainLightIntensity: 4 } } };
    const restored = normalizeStageScene(JSON.parse(JSON.stringify(scene)));
    expect(restored).toEqual(scene);
    expect(actorLighting(restored, 'a', defaultCharacterRenderConfig)).toMatchObject({ mainLightIntensity: 1, rimStrength: 0.8 });
    expect(actorLighting(restored, 'b', defaultCharacterRenderConfig).rimStrength).toBe(defaultCharacterRenderConfig.rimStrength);
    expect(defaultCharacterRenderConfig.mainLightIntensity).toBe(3);
  });
  it('validates commands before the stage can change the meeting queue', () => {
    expect(isStageMeetingCommand({ type: 'send', sessionId: 's', speakerId: 'a', text: '你好' })).toBe(true);
    expect(isStageMeetingCommand({ type: 'send', sessionId: 's', speakerId: 'a', text: ' ' })).toBe(false);
    expect(isStageMeetingCommand({ type: 'send', sessionId: 's', speakerId: 'a', text: 'a'.repeat(4001) })).toBe(false);
    expect(isStageMeetingCommand({ type: 'participant', sessionId: 's', characterId: 3 })).toBe(false);
  });
});
