import { describe, expect, it, vi } from 'vitest';
import { ActionLoader } from './ActionLoader';
import { ActionRuntime } from './ActionRuntime';
import { RuntimeStore } from '../../../app/state/RuntimeStore';
import { ExpressionController } from '../../expression/ExpressionController';
import config from '../assets/actions/full-body-motion-config.json';
import segments from '../assets/vrma-segments.json';
import { validateEmotionConfig } from './emotionConfig';
import type { VrmaSegmentConfig } from '../assets/vrmaSegments';

describe('emotion composition', () => {
  it('keeps expression through a looping speech filler and releases it on idle', async () => {
    const store = new RuntimeStore();
    const face = { setExpression: vi.fn() };
    const body = { play: vi.fn().mockResolvedValue(undefined) };
    const micro = { play: vi.fn(), stop: vi.fn() };
    const actions = new ActionRuntime(new ActionLoader(), body as never, store, new ExpressionController(store, face));
    actions.setMicroDynamics(micro);
    actions.startSpeaking();
    await actions.play(['happy_small']);
    await Promise.resolve();
    expect(body.play.mock.calls.map(([id]) => id)).toEqual(['happy_small', config.speaking]);
    expect(body.play.mock.calls[1][1].loop).toBe('repeat');
    expect(store.getSnapshot().expression.id).toBe('happy');
    expect(micro.play).toHaveBeenCalledWith('smallSmile');
    actions.returnToIdle();
    expect(store.getSnapshot().expression.id).toBe('neutral');
    expect(micro.stop).toHaveBeenCalled();
  });

  it('validates segment references and A scheduling at the save boundary', () => {
    const source = segments as VrmaSegmentConfig;
    expect(validateEmotionConfig(config, source)).toBe(config);
    const invalid = structuredClone(config);
    invalid.emotion.listen_focus.vrma.start = -1;
    expect(() => validateEmotionConfig(invalid, source)).toThrow('listen_focus');
    const invalidSchedule = structuredClone(config);
    invalidSchedule.microdynamicsSchedule.rules[0].action = 'shySquint';
    expect(() => validateEmotionConfig(invalidSchedule, source)).toThrow('A');
  });
});
