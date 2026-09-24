import { describe, expect, it, vi } from 'vitest';
import { MOOD_PRESENTATION, applyMoodPresentation } from './moodPresentation';
import { PERSONALITY_MOODS } from '../../ai/llm/types';
import microConfig from '../micro-dynamics/micro-dynamics.json';
import fullBody from '../motion/assets/actions/full-body-motion-config.json';

describe('mood presentation', () => {
  it('covers every mood with an expression and existing B/C micro actions', () => {
    const expressionIds = new Set(Object.keys(fullBody.expressions));
    const actions = new Map(microConfig.actions.map((action) => [action.id, action.tier]));
    expect(Object.keys(MOOD_PRESENTATION).sort()).toEqual([...PERSONALITY_MOODS].sort());
    for (const [mood, presentation] of Object.entries(MOOD_PRESENTATION)) {
      expect(expressionIds.has(presentation.expression), `${mood} expression`).toBe(true);
      for (const id of presentation.microdynamics) {
        // 只有 B/C 档属于 LLM 情绪；A 档由微动作调度器自己跑。
        expect(['B', 'C'], `${mood} → ${id}`).toContain(actions.get(id));
      }
    }
  });

  it('sets the expression and layers the micro actions', () => {
    const set = vi.fn();
    const play = vi.fn();
    applyMoodPresentation({ expression: { set }, microdynamics: { play } }, 'shy', 1);

    expect(set).toHaveBeenCalledWith('happy', 1, 900);
    expect(play.mock.calls.map(([id]) => id)).toEqual(['shySquint', 'earRelax']);
  });

  it('keeps a visible expression at low intensity and clamps the weight', () => {
    const set = vi.fn();
    applyMoodPresentation({ expression: { set } }, 'neutral', 0);
    expect(set).toHaveBeenCalledWith('neutral', 0.55, 900);

    applyMoodPresentation({ expression: { set } }, 'neutral', 9);
    expect(set).toHaveBeenLastCalledWith('neutral', 1, 900);
  });
});
