import { describe, expect, it, vi } from 'vitest';
import { ActionLoader, actionIdleMotionId, actionMotionId } from './ActionLoader';
import config from '../assets/actions/full-body-motion-config.json';
import segments from '../assets/vrma-segments.json';
import { findEmotionSegment, validateEmotionConfig } from './emotionConfig';
import type { VrmaSegmentConfig } from '../assets/vrmaSegments';

const fullBodyParts = ['Root', 'LowerBody', 'Torso', 'Head', 'LeftArm', 'RightArm', 'Face'];

describe('ActionLoader full-body catalog', () => {
  it('builds idle, emotion, and casual actions from the current catalog', () => {
    const loader = new ActionLoader();
    const actions = loader.listActions();
    expect(actions.some((action) => action.state === 'idle')).toBe(true);
    expect(actions.some((action) => action.state === 'emotion')).toBe(true);
    expect(actions.some((action) => action.state === 'casual')).toBe(true);
    expect(
      actions.filter((action) => !Object.hasOwn(config.emotion, action.id)).every((action) => fullBodyParts.every((part) => action.parts.includes(part as never)))
    ).toBe(true);
    for (const [id, definition] of Object.entries(config.emotion)) {
      const segment = findEmotionSegment(definition.vrma, segments as VrmaSegmentConfig)!;
      expect(loader.getAction(id).parts).toEqual(segment.parts);
      expect(loader.createMotionMetas().find((meta) => meta.id === id)?.bodyParts).toEqual(segment.parts);
    }
  });

  it('converts configured frame ranges to seconds and produces direct motion ids', () => {
    const loader = new ActionLoader();
    const action = loader.listActions().find((item) => item.enter);
    expect(action).toBeDefined();
    const meta = loader.createMotionMetas().find((item) => item.id === action!.id);
    expect(meta).toMatchObject({
      id: actionMotionId(action!.id),
      trimStartSeconds: action!.enter!.start,
      trimEndSeconds: action!.enter!.end,
      layer: 'base'
    });
    expect(actionIdleMotionId()).toBe(loader.listActions().find((item) => item.state === 'idle')?.id);
  });

  it('rejects unknown action ids', () => {
    expect(() => new ActionLoader().getAction('missing-action')).toThrow('Unknown action: missing-action');
  });

  it('supports emotion trimming inside a saved segment and isolates invalid bindings', () => {
    const edited = structuredClone(config);
    const ref = edited.emotion.shrug_small.vrma;
    const source = structuredClone(segments) as VrmaSegmentConfig;
    source[ref.file] = [{ start: 0, end: 60, description: ref.description, parts: ['Head'], loop: { mode: 'none' } }];
    ref.start = 1;
    ref.end = 60;
    expect(() => validateEmotionConfig(edited, source)).not.toThrow();
    const loader = new ActionLoader({ config: edited, segments: source });
    expect(loader.getAction('shrug_small')).toMatchObject({ parts: ['Head'], enter: { start: 1 / 30, end: 2 } });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      ref.end = 61;
      expect(() => validateEmotionConfig(edited, source)).toThrow('shrug_small');
      const recovered = new ActionLoader({ config: edited, segments: source });
      expect(recovered.listActions().some((action) => action.state === 'idle')).toBe(true);
      expect(recovered.getAction('hand_explain')).toBeDefined();
      expect(() => recovered.getAction('shrug_small')).toThrow('Unknown action');
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('shrug_small'));
    } finally { warning.mockRestore(); }
  });
});
