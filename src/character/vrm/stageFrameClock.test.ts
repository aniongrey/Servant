import { describe, expect, it } from 'vitest';
import {
  advanceActorFrameSchedule,
  advanceStageFrameClock,
  createActorFrameSchedule,
  createStageFrameClock,
  MAX_FRAME_BACKLOG_MS,
  MAX_FRAME_DELTA_SECONDS
} from './stageFrameClock';

const STAGE_RATE = 60;

/**
 * Feeds a perfectly stable refresh-rate series through the clock, which is how the
 * original bug was found: 144 Hz input, 48 updates per second out.
 */
function simulate(displayHz: number, seconds: number, rate = STAGE_RATE) {
  const clock = createStageFrameClock();
  const refreshMs = 1000 / displayHz;
  let draws = 0;
  let deltaSeconds = 0;
  for (let index = 0; index <= Math.round(displayHz * seconds); index += 1) {
    const decision = advanceStageFrameClock(clock, index * refreshMs, rate);
    if (!decision.draw) continue;
    draws += 1;
    deltaSeconds += decision.deltaSeconds;
  }
  return { draws, deltaSeconds, clock };
}

describe('stage frame clock', () => {
  it('holds the requested rate on a 144 Hz display instead of collapsing to 48', () => {
    const { draws } = simulate(144, 10);
    // The frame drawn at t = 0 is not part of the ten seconds that follow it.
    const updatesPerSecond = (draws - 1) / 10;
    expect(updatesPerSecond).toBeCloseTo(60, 0);
    // The discarded-remainder gate this replaces drew every third refresh: 48/s.
    expect(updatesPerSecond).toBeGreaterThan(59);
  });

  it('draws every refresh when the display matches the requested rate', () => {
    const { draws } = simulate(60, 10);
    expect(draws).toBe(601);
  });

  it('never draws faster than the display, whichever way the rate points', () => {
    expect((simulate(90, 10).draws - 1) / 10).toBeCloseTo(60, 0);
    expect((simulate(30, 10).draws - 1) / 10).toBeCloseTo(30, 0);
    expect((simulate(120, 10).draws - 1) / 10).toBeCloseTo(60, 0);
  });

  it('does not lose animation time while skipping refresh frames', () => {
    const { deltaSeconds } = simulate(144, 10);
    // Every skipped frame's time is carried into the next step, so the steps still
    // add up to the ten seconds that were simulated. The extra frame interval is
    // the synthetic first step, which has nothing before it to measure against.
    expect(deltaSeconds).toBeGreaterThan(9.95);
    expect(deltaSeconds).toBeLessThan(10.05);
  });

  it('draws one frame after a stall instead of catching up in a burst', () => {
    const clock = createStageFrameClock();
    const refreshMs = 1000 / 144;
    expect(advanceStageFrameClock(clock, 0, STAGE_RATE).draw).toBe(true);

    // Half a second of nothing: a hidden window, a long task, a breakpoint.
    const afterStall = advanceStageFrameClock(clock, 500, STAGE_RATE);
    expect(afterStall.draw).toBe(true);
    expect(afterStall.deltaSeconds).toBe(MAX_FRAME_DELTA_SECONDS);
    expect(clock.backlog).toBeLessThan(MAX_FRAME_BACKLOG_MS);

    let draws = 0;
    for (let index = 1; index <= 144; index += 1) {
      if (advanceStageFrameClock(clock, 500 + index * refreshMs, STAGE_RATE).draw) draws += 1;
    }
    expect(draws).toBeGreaterThanOrEqual(59);
    expect(draws).toBeLessThanOrEqual(61);
  });

  it('keeps the nominal stage clock locked to real time instead of drifting', () => {
    // Ten minutes of 144 Hz input, so the carried remainder cannot slowly walk the
    // nominal clock away from the wall clock.
    const { draws, clock } = simulate(144, 600);
    expect(draws).toBeGreaterThanOrEqual(36_000);
    expect(draws).toBeLessThanOrEqual(36_001);
    expect(Math.abs(clock.elapsed - 600)).toBeLessThan(0.04);
  });
});

describe('actor frame schedule', () => {
  it('updates an actor at the stage rate on every drawn frame', () => {
    const schedule = createActorFrameSchedule();
    const clock = createStageFrameClock();
    let draws = 0;
    let updates = 0;
    for (let index = 0; index <= 144 * 10; index += 1) {
      const decision = advanceStageFrameClock(clock, index * (1000 / 144), STAGE_RATE);
      if (!decision.draw) continue;
      draws += 1;
      if (
        advanceActorFrameSchedule(schedule, decision.clockSeconds, STAGE_RATE, decision.deltaSeconds).update
      ) {
        updates += 1;
      }
    }
    // The second, independently-based check this replaces dropped updates even on
    // frames the stage had decided to draw.
    expect(draws).toBeGreaterThan(590);
    expect(updates).toBe(draws);
  });

  it('lands an actor asking for half the stage rate on every second frame', () => {
    const schedule = createActorFrameSchedule();
    const clock = createStageFrameClock();
    const steps: number[] = [];
    for (let index = 0; index <= 600; index += 1) {
      const decision = advanceStageFrameClock(clock, index * (1000 / 60), STAGE_RATE);
      if (!decision.draw) continue;
      const actor = advanceActorFrameSchedule(schedule, decision.clockSeconds, 30, decision.deltaSeconds);
      if (actor.update) steps.push(actor.deltaSeconds);
    }
    expect(steps.length).toBeGreaterThanOrEqual(300);
    expect(steps.length).toBeLessThanOrEqual(302);
    // Half the updates means twice the animation step on each of them.
    expect(steps[1]).toBeGreaterThan(0.03);
  });

  it('gives an actor its first update on the first drawn frame', () => {
    const schedule = createActorFrameSchedule();
    const clock = createStageFrameClock();
    const first = advanceStageFrameClock(clock, 0, STAGE_RATE);
    expect(advanceActorFrameSchedule(schedule, first.clockSeconds, 30, first.deltaSeconds).update).toBe(true);
  });
});
