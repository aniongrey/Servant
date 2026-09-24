import { describe, expect, it, vi } from 'vitest';
import { ReplyShortActionRuntime } from './ReplyShortActionRuntime';
import { defaultReplyShortActionId } from './shortActionVocabulary';

function createRuntime() {
  const play = vi.fn().mockResolvedValue(undefined);
  const returnToIdle = vi.fn();
  return { play, returnToIdle, runtime: new ReplyShortActionRuntime({ play, returnToIdle } as never) };
}

describe('ReplyShortActionRuntime', () => {
  it('plays a combo action as body-only so emotion keeps the face', async () => {
    const { play, runtime } = createRuntime();

    await runtime.play('wave_small');

    expect(play).toHaveBeenCalledWith(['wave_small'], { signal: undefined, presentation: false });
  });

  it('falls back to the default action for ids outside the vocabulary', async () => {
    const { play, runtime } = createRuntime();

    await runtime.play('agree');

    expect(play).toHaveBeenCalledWith([defaultReplyShortActionId], {
      signal: undefined,
      presentation: false
    });
  });

  it('delegates returnToIdle to the action runtime', () => {
    const { returnToIdle, runtime } = createRuntime();

    runtime.returnToIdle();

    expect(returnToIdle).toHaveBeenCalledOnce();
  });
});
