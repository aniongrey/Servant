import {
  PERSONALITY_MOODS,
  type PersonalityConfig,
  type PersonalityMood,
  type PersonalityState
} from '../llm/types';

const POSITIVE_PATTERN = /谢谢|喜欢|开心|真棒|可爱|很好|爱你/i;
const NEGATIVE_PATTERN = /难过|伤心|生气|讨厌|糟糕|不开心/i;

export function createDefaultPersonalityState(config: PersonalityConfig): PersonalityState {
  return {
    mood: config.defaultEmotion,
    energy: 0.6,
    engagement: 0.5,
    lastInteractionAt: 0,
    recentTopics: [],
    frozen: false
  };
}

export function applyUserInteraction(state: PersonalityState, text: string): PersonalityState {
  if (state.frozen) {
    return state;
  }
  const topic = text.trim().slice(0, 18);
  return {
    ...state,
    mood: detectMood(text, state.mood),
    energy: clamp01(state.energy + 0.02),
    engagement: clamp01(state.engagement + 0.1),
    lastInteractionAt: Date.now(),
    recentTopics: topic ? [...state.recentTopics, topic].slice(-4) : state.recentTopics
  };
}

export function applyAssistantPresentation(
  state: PersonalityState,
  presentation: { emotion: PersonalityMood; intensity: number }
): PersonalityState {
  if (state.frozen) {
    return state;
  }
  return {
    ...state,
    mood: presentation.emotion,
    energy: clamp01(state.energy + (presentation.intensity - 0.5) * 0.08),
    engagement: clamp01(state.engagement - 0.01),
    lastInteractionAt: Date.now()
  };
}

export function normalizePersonalityState(
  value: Partial<PersonalityState> | undefined,
  config: PersonalityConfig
): PersonalityState {
  const fallback = createDefaultPersonalityState(config);
  return {
    mood: isMood(value?.mood) ? value.mood : fallback.mood,
    energy: readUnit(value?.energy, fallback.energy),
    engagement: readUnit(value?.engagement, fallback.engagement),
    lastInteractionAt: typeof value?.lastInteractionAt === 'number' ? value.lastInteractionAt : 0,
    recentTopics: Array.isArray(value?.recentTopics)
      ? value.recentTopics.filter((topic): topic is string => typeof topic === 'string').slice(-4)
      : [],
    frozen: value?.frozen === true
  };
}

function detectMood(text: string, fallback: PersonalityMood): PersonalityMood {
  if (POSITIVE_PATTERN.test(text)) return 'happy';
  if (NEGATIVE_PATTERN.test(text)) return 'concerned';
  if (/为什么|怎么|什么|吗[？?]?$/i.test(text)) return 'curious';
  return fallback === 'angry' || fallback === 'sad' ? 'neutral' : fallback;
}

function isMood(value: unknown): value is PersonalityMood {
  return PERSONALITY_MOODS.includes(value as PersonalityMood);
}

function readUnit(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp01(value) : fallback;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
