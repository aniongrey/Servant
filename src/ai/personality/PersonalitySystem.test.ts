import { describe, expect, it, vi } from 'vitest';
import {
  applyAssistantPresentation,
  applyUserInteraction,
  createDefaultPersonalityState
} from './PersonalitySystem';
import type { PersonalityConfig } from '../llm/types';

const config: PersonalityConfig = {
  id: 'test',
  displayName: 'Test',
  identity: 'companion',
  traits: [],
  speakingStyle: [],
  boundaries: [],
  defaultEmotion: 'neutral'
};

describe('PersonalitySystem', () => {
  it('updates short-term state deterministically', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    const next = applyUserInteraction(createDefaultPersonalityState(config), '你今天真可爱');

    expect(next.mood).toBe('happy');
    expect(next.engagement).toBeCloseTo(0.6);
    expect(next.lastInteractionAt).toBe(1234);
    expect(next.recentTopics).toEqual(['你今天真可爱']);
  });

  it('does not let model output update a frozen personality', () => {
    const frozen = { ...createDefaultPersonalityState(config), frozen: true };
    const next = applyAssistantPresentation(frozen, { emotion: 'angry', intensity: 1 });

    expect(next).toBe(frozen);
  });
});
