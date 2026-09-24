import { describe, expect, it } from 'vitest';
import { createAgentRuntime } from '../../../ai/AgentRuntime';

describe('GameEventReactionDispatcher', () => {
  it('routes a POE2 divine drop into the immediate reaction event', async () => {
    const engine = createAgentRuntime({ persist: false });

    await engine.gameEvents.reactions.dispatch({
      type: 'LOOT_DROP',
      game: 'poe2',
      timestamp: Date.now(),
      source: 'test',
      item: 'Divine Orb',
      rarity: 90,
      priority: 90
    });

    const snapshot = engine.store.getSnapshot();
    expect(snapshot.logs.some((log) => log.message === 'Started poe2_divine_drop_001')).toBe(true);
    expect(snapshot.speech.text).toBe('等等……神圣石？！快捡！');
  });
});
