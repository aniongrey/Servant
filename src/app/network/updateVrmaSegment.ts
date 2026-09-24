import type { VrmaSegment, VrmaSegmentConfig } from '../../character/motion/assets/vrmaSegments.ts';
import { findEmotionSegment, type FullBodyConfig } from '../../character/motion/actions/emotionConfig.ts';

export function updateVrmaSegment(
  segments: VrmaSegmentConfig, actions: FullBodyConfig, file: string, index: number,
  original: VrmaSegment, replacement: VrmaSegment
): { segments: VrmaSegmentConfig; actions: FullBodyConfig } {
  const previous = segments[file]?.[index];
  if (!Number.isInteger(index) || !previous || !original ||
    previous.start !== original.start || previous.end !== original.end || previous.description !== original.description ||
    JSON.stringify(previous.parts) !== JSON.stringify(original.parts) || JSON.stringify(previous.loop) !== JSON.stringify(original.loop))
    throw new Error('片段已变更，请重新载入后编辑');
  const nextSegments = structuredClone(segments);
  const nextActions = structuredClone(actions);
  nextSegments[file][index] = replacement;
  for (const action of Object.values(nextActions.emotion)) {
    if (findEmotionSegment(action.vrma, segments) === previous)
      action.vrma = { file, start: replacement.start, end: replacement.end, description: replacement.description };
  }
  return { segments: nextSegments, actions: nextActions };
}
