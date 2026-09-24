import { describe, expect, it } from 'vitest';
import {
  defaultReplyShortActionId,
  isReplyShortActionId,
  replyShortActionIds,
  resolveReplyShortActionId
} from './shortActionVocabulary';
import fullBody from '../assets/actions/full-body-motion-config.json';

describe('shortActionVocabulary', () => {
  it('is exactly the combo action table', () => {
    expect(replyShortActionIds).toEqual(Object.keys(fullBody.emotion));
    expect(replyShortActionIds).toContain('hand_explain');
  });

  it('keeps the fallback inside the vocabulary', () => {
    expect(replyShortActionIds).toContain(defaultReplyShortActionId);
    expect(defaultReplyShortActionId).toBe(fullBody.speaking);
  });

  it('normalizes anything outside the vocabulary to the fallback', () => {
    expect(isReplyShortActionId('wave_small')).toBe(true);
    expect(isReplyShortActionId('agree')).toBe(false);
    expect(isReplyShortActionId(null)).toBe(false);
    expect(resolveReplyShortActionId('agree')).toBe(defaultReplyShortActionId);
    expect(resolveReplyShortActionId('wave_small')).toBe('wave_small');
  });
});
