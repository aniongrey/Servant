import { describe, expect, it } from 'vitest';
import { resolveVrmModelOption, toServedAssetUrl, toModelId, vrmModelOptions } from './vrmModels';

describe('toModelId', () => {
  it('keeps Chinese VRM filenames distinct and stable', () => {
    expect(toModelId('纳西妲')).toBe('纳西妲');
    expect(toModelId('可莉')).toBe('可莉');
  });

  it('normalizes ASCII filenames', () => {
    expect(toModelId('Hayaseyuuka.vrm')).toBe('hayaseyuuka');
  });
});

describe('vrm asset urls', () => {
  it('maps the glob url onto the path the page actually serves', () => {
    expect(toServedAssetUrl('/public/assets/character/可莉.vrm')).toBe('/assets/character/可莉.vrm');
    expect(toServedAssetUrl('/public/assets/character/%E5%8F%AF%E8%8E%89.vrm')).toBe(
      '/assets/character/可莉.vrm'
    );
    expect(toServedAssetUrl('/assets/character/可莉.vrm')).toBe('/assets/character/可莉.vrm');
  });

  it('resolves the bundled model from its default-character.json name', () => {
    const bundled = resolveVrmModelOption('main');
    expect(bundled.url).toBe('/assets/character/可莉.vrm');
    expect(vrmModelOptions[0]).toEqual(bundled);
  });
});
