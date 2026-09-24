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
});
