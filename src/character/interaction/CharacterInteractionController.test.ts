import { describe, expect, it, vi } from 'vitest';
import { CharacterInteractionController } from './CharacterInteractionController';
function createController() {
  const action = { start: vi.fn(), notifyInteraction: vi.fn(), playEmotion: vi.fn() };
  const speech = {
    sayText: vi.fn(async () => undefined),
    sayLocalizedText: vi.fn(
      async (_text: string, _options: { intent: string; signal: AbortSignal }) => undefined
    )
  };
  const store = {
    appendLog: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    getSnapshot: vi.fn(() => ({ speech: { speaking: false } }))
  };
  const effects = { onHeadSquash: vi.fn(), onProtectedHeadTap: vi.fn() };
  return {
    controller: new CharacterInteractionController(action as never, speech as never, store as never, effects),
    action,
    speech,
    effects
  };
}
describe('CharacterInteractionController', () => {
  it('keeps dance pending until a business state returns to idle', () => {
    const { controller, action } = createController();
    controller.onListeningStart();
    controller.setMusicPlaying(true);
    expect(controller.getState()).toBe('listening');
    controller.onSpeechEnd();
    expect(controller.getState()).toBe('dancing');
    expect(action.notifyInteraction).toHaveBeenCalled();
    controller.dispose();
  });
  it('publishes multiple activity statuses while preserving the interaction state', () => {
    const { controller } = createController();
    const snapshots: string[][] = [];
    const unsubscribe = controller.subscribeActivityStatuses((statuses) => snapshots.push(statuses));
    controller.onListeningEnd();
    controller.replaceActivityStatuses(['thinking', 'searching']);
    expect(controller.getState()).toBe('thinking');
    expect(controller.getActivityStatuses()).toEqual(['thinking', 'searching']);
    expect(snapshots.at(-1)).toEqual(['thinking', 'searching']);
    unsubscribe();
    controller.dispose();
  });
  it('turns five head touches into protect-head and blocks further squash feedback', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.05);
    const { controller, effects, speech, action } = createController();
    for (let index = 0; index < 5; index += 1) controller.onHeadClick();
    expect(effects.onHeadSquash).toHaveBeenCalledTimes(5);
    expect(action.playEmotion).toHaveBeenCalledWith('无奈');
    expect(speech.sayLocalizedText).toHaveBeenCalledWith(expect.stringContaining('825.36'), {
      intent: 'protect_head',
      signal: expect.any(AbortSignal)
    });
    controller.onHeadClick();
    expect(effects.onProtectedHeadTap).toHaveBeenCalledTimes(1);
    controller.dispose();
    expect(speech.sayLocalizedText.mock.calls[0][1].signal.aborted).toBe(true);
  });
});
