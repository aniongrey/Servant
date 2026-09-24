import { describe, expect, it } from 'vitest';
import { createAgentRuntime } from '../../../ai/AgentRuntime';
import { MockVrmaLoader } from '../../../character/motion/MockVrmaLoader';

describe('TriggerEngine', () => {
  it('routes built-in emotion actions through the director', async () => {
    const engine = createAgentRuntime({
      persist: false,
      motionLoader: new MockVrmaLoader(0)
    });

    await engine.trigger.fire('missedPromise');

    const snapshot = engine.store.getSnapshot();
    expect(snapshot.emotions.anger).toBeGreaterThan(0.5);
    expect(snapshot.trigger.lastBuiltInTrigger).toBe('missedPromise');
    expect(snapshot.trigger.lastEventId).toBe('angry_tsundere_001');
  });

  it('matches custom text triggers and plays their event', async () => {
    const engine = createAgentRuntime({
      persist: false,
      motionLoader: new MockVrmaLoader(0)
    });

    await engine.trigger.submitText('我下班啦');

    const snapshot = engine.store.getSnapshot();
    expect(snapshot.trigger.lastMatchedTrigger).toBe('custom_welcome_home');
    expect(snapshot.trigger.lastEventId).toBe('welcome_home_custom_01');
  });
});
