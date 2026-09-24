import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHarness } from './liveTestHarness';
import { runScenario } from './liveTestEvents';

afterEach(() => vi.restoreAllMocks());

describe('live test session', () => {
  it('coalesces concurrent manual and automatic ticks and recovers after failure', async () => {
    const harness = createHarness();
    let reject!: (error: Error) => void;
    const tick = vi.spyOn(harness.system, 'tick').mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        })
    );
    const pending = harness.tick();
    await harness.tick();
    expect(tick).toHaveBeenCalledTimes(1);
    reject(new Error('consumer failed'));
    await pending;
    expect(harness.activity.at(-1)).toMatchObject({ category: 'LIVE_ERROR', message: 'consumer failed' });
    await harness.tick();
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('stops notifying a detached view when pending work finishes', async () => {
    const harness = createHarness();
    const notify = vi.fn();
    harness.setOnChange(notify);
    let finish!: () => void;
    vi.spyOn(harness.system, 'tick').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const pending = harness.tick();
    harness.setOnChange(undefined);
    finish();
    await pending;
    expect(notify).not.toHaveBeenCalled();
  });

  it('keeps a duplicate scenario in one queue position with all users counted', () => {
    const harness = createHarness();
    runScenario('duplicate', harness.ingest);
    const events = [
      ...harness.system.queue.high,
      ...harness.system.queue.normal,
      ...harness.system.queue.low
    ];
    expect(events).toHaveLength(1);
    expect(events[0].metadata?.aggregation).toMatchObject({ count: 30, uniqueUsers: 30 });
  });

  it('clears response records without clearing processing activity', async () => {
    const harness = createHarness();
    runScenario('gift', harness.ingest);
    await harness.tick();
    expect(harness.responses).toHaveLength(1);
    harness.clearResponses();
    expect(harness.responses).toHaveLength(0);
    expect(harness.activity.length).toBeGreaterThan(0);
    harness.clearActivity();
    expect(harness.activity).toHaveLength(0);
  });
});
