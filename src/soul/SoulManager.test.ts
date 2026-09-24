import { describe, expect, it } from 'vitest';
import { MemorySoulStorage, SoulManager } from './index';

describe('SoulManager', () => {
  it('applies deterministic events, clamps ranges and keeps only ten recent events', () => {
    let now = 1_000;
    const storage = new MemorySoulStorage();
    const manager = new SoulManager({ storage, now: () => now });
    for (let index = 0; index < 12; index += 1) {
      now += 1;
      manager.record('belittle', `贬低 ${index}`);
    }
    expect(manager.getState().mood.anger).toBe(96);
    expect(manager.getState().recentEvents).toHaveLength(10);
    expect(storage.load('shiro')).toEqual(manager.getState());
  });

  it('keeps relation stable while mood decays with different inertia', () => {
    const manager = new SoulManager({
      state: {
        mood: { happiness: 50, anger: 50, sadness: 50 },
        relation: { intimacy: 60, trust: 70 },
        currentNeed: 'none',
        recentEvents: [],
        updatedAt: 1
      },
      autoSave: false,
      now: () => 60_001
    });
    manager.decay(60_000);
    const state = manager.getState();
    expect(state.relation).toEqual({ intimacy: 60, trust: 70 });
    expect(state.mood).toEqual({ happiness: 49, anger: 48.5, sadness: 49.75 });
  });

  it('describes levels, needs and recent events without exposing mutation authority', () => {
    const manager = new SoulManager({ autoSave: false });
    manager.record('chat', 'LLM 判断为普通聊天', 10);
    const prompt = manager.getPromptContext();
    expect(prompt).toContain('[Current Soul State]');
    expect(prompt).toContain('当前需求：none');
    expect(prompt).toContain('- LLM 判断为普通聊天');
    expect(prompt).toContain('不要擅自修改');
  });

  it('applies fixed numeric rules for praise, chat and belittle', () => {
    const manager = new SoulManager({ autoSave: false });
    manager.record('chat', 'LLM 判断为聊天');
    manager.record('praise', 'LLM 判断为夸奖');
    manager.record('belittle', 'LLM 判断为贬低');
    const state = manager.getState();
    expect(state.relation).toEqual({ intimacy: 21.25, trust: 29.1 });
    expect(state.mood).toEqual({ happiness: 12, anger: 8, sadness: 3 });
  });

  it('normalizes manually managed values before saving', () => {
    const manager = new SoulManager({ autoSave: false });
    manager.setState({
      ...manager.getState(),
      mood: { happiness: -120, anger: 500, sadness: -2 },
      relation: { intimacy: 101, trust: -1 }
    });
    expect(manager.getState()).toMatchObject({
      mood: { happiness: -100, anger: 100, sadness: 0 },
      relation: { intimacy: 100, trust: 0 }
    });
  });
});
