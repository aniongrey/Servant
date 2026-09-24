import { describe, expect, it } from 'vitest';
import { resolveInteractionHints } from './interactionHints';

describe('interaction hints', () => {
  it('shows every desktop hint while the preference is on', () => {
    expect(resolveInteractionHints(true)).toEqual({
      characterStatus: true,
      toolResult: true,
      speechBubble: true
    });
  });

  it('hides the desktop status chips, the tool card, and the speech bubble together', () => {
    expect(resolveInteractionHints(false)).toEqual({
      characterStatus: false,
      toolResult: false,
      speechBubble: false
    });
  });
});
