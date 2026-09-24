import { describe, expect, it } from 'vitest';
import rawConfig from './micro-dynamics.json';
import { parseMicroDynamicsConfig, sampleTrack } from './config';

describe('micro dynamics config', () => {
  it('contains the laboratory set plus configurable ahoge motion', () => {
    const config = parseMicroDynamicsConfig(rawConfig);
    expect(config.actions).toHaveLength(25);
    expect(new Set(config.actions.map((action) => action.id)).size).toBe(25);
    expect(config.actions.find((action) => action.id === 'ahogeSway')?.tracks[0].target).toBe('ahoge');
    expect(new Set(config.actions.map((action) => action.tier))).toEqual(new Set(['A', 'B', 'C']));
  });

  it('interpolates keyframes', () => {
    expect(
      sampleTrack(
        {
          keyframes: [
            { at: 0, value: 0 },
            { at: 1, value: 1 }
          ]
        },
        0.25
      )
    ).toBe(0.25);
  });

  it('rejects invalid morph binding candidates', () => {
    const config = structuredClone(rawConfig);
    config.bindings.morphs.eyeWide = [''];
    expect(() => parseMicroDynamicsConfig(config)).toThrow('bindings.morphs');
  });

  it('drives gaze through portable humanoid eye bones', () => {
    const config = parseMicroDynamicsConfig(rawConfig);
    expect(config.bindings.bones.eyeLeftY).toEqual({ node: '@humanoid:leftEye', axis: 'y' });
    expect(config.bindings.bones.eyeRightX).toEqual({ node: '@humanoid:rightEye', axis: 'x' });
    expect(
      config.actions.find((action) => action.id === 'gazeShiftX')?.tracks.map((track) => track.target)
    ).toEqual(['eyeLeftY', 'eyeRightY']);
    expect(
      config.actions.find((action) => action.id === 'gazeShiftDown')?.tracks.map((track) => track.target)
    ).toEqual(['eyeLeftX', 'eyeRightX']);
  });
});
