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


describe('registered action behaviors', () => {
  it('rejects unregistered JS behavior names at the config boundary', () => {
    const invalid = structuredClone(config);
    invalid.emotion.wear_iron_basin.behavior = 'unregistered_script';
    expect(() => validateEmotionConfig(invalid, segments as VrmaSegmentConfig)).toThrow('wear_iron_basin');
    expect(new ActionLoader().getAction('wear_iron_basin').behavior).toBe('wear_iron_basin');
  });

  it('triggers behavior for body-only replies and clears it on stop', async () => {
    const body = { preload: vi.fn().mockResolvedValue(undefined), play: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) };
    const behaviors = { play: vi.fn().mockResolvedValue(undefined), clear: vi.fn() };
    const runtime = new ActionRuntime(new ActionLoader(), body as never, new RuntimeStore());
    runtime.setBehaviors(behaviors);
    await runtime.play(['wear_iron_basin'], { presentation: false });
    expect(body.preload).toHaveBeenCalledWith('wear_iron_basin', expect.any(AbortSignal));
    expect(behaviors.play).toHaveBeenCalledWith('wear_iron_basin', 117 / 30, expect.any(AbortSignal));
    expect(body.play.mock.calls[0][0]).toBe('wear_iron_basin');
    expect(behaviors.clear).not.toHaveBeenCalled();
    await runtime.stopAll();
    expect(behaviors.clear).toHaveBeenCalledOnce();
  });

  it('reports prop loading errors to the caller and cleans the failed behavior', async () => {
    const body = { preload: vi.fn().mockResolvedValue(undefined), play: vi.fn() };
    const behaviors = { play: vi.fn().mockRejectedValue(new Error('prop unavailable')), clear: vi.fn() };
    const runtime = new ActionRuntime(new ActionLoader(), body as never, new RuntimeStore());
    runtime.setBehaviors(behaviors);
    await expect(runtime.play(['wear_iron_basin'], { propagateError: true })).rejects.toThrow('prop unavailable');
    expect(body.play).not.toHaveBeenCalled();
    expect(behaviors.clear).toHaveBeenCalledOnce();
  });
});
