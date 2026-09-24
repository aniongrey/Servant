import { describe, expect, it } from 'vitest';
import { updateVrmaSegment } from './updateVrmaSegment';
import config from '../../character/motion/assets/actions/full-body-motion-config.json';
import type { VrmaSegmentConfig } from '../../character/motion/assets/vrmaSegments';

describe('updateVrmaSegment', () => {
  it('replaces a segment without adding a duplicate and updates all emotion references', () => {
    const ref = { file: 'test.vrma', start: 0, end: 60, description: '测试动作' };
    const segments: VrmaSegmentConfig = { [ref.file]: [{ start: 0, end: 60, description: ref.description, parts: ['Head'], loop: { mode: 'none' } }] };
    const actions = structuredClone(config);
    actions.emotion.hand_explain.vrma = { ...ref };
    actions.emotion.hand_present.vrma = { ...ref };
    const index = segments[ref.file].findIndex((item) => item.start === ref.start && item.end === ref.end && item.description === ref.description);
    const original = segments[ref.file][index];
    actions.emotion.hand_present.vrma.start = original.start + 1;
    const replacement = { ...original, start: original.start + 1, description: '更新的片段' };
    const updated = updateVrmaSegment(segments, actions, ref.file, index, original, replacement);
    expect(updated.segments[ref.file]).toHaveLength(segments[ref.file].length);
    expect(updated.segments[ref.file][index]).toEqual(replacement);
    expect(updated.actions.emotion.hand_explain.vrma.description).toBe('更新的片段');
    expect(updated.actions.emotion.hand_present.vrma.start).toBe(replacement.start);
    expect(actions.emotion.hand_explain.vrma).toEqual(ref);
    expect(() => updateVrmaSegment(updated.segments, updated.actions, ref.file, index, original, replacement)).toThrow('已变更');
  });

  it('uses the segment description as its id and updates every composition list', () => {
    const file = 'test.vrma';
    const original = { start: 0, end: 60, description: '说明', parts: ['Head'] as ('Head')[], loop: { mode: 'none' as const } };
    const segments: VrmaSegmentConfig = { [file]: [original] };
    const actions = structuredClone(config);
    actions.idle = '说明';
    actions.emotions = ['说明'];
    actions.casual = ['说明'];
    actions.emotion.hand_explain.vrma = { file, start: 0, end: 60, description: '说明' };
    const replacement = { ...original, description: '更新说明' };
    const updated = updateVrmaSegment(segments, actions, file, 0, original, replacement);
    expect(updated.actions.idle).toBe('更新说明');
    expect(updated.actions.emotions).toEqual(['更新说明']);
    expect(updated.actions.casual).toEqual(['更新说明']);
    expect(updated.actions.emotion.hand_explain.vrma.description).toBe('更新说明');
  });
});
