import type { PersonalityMood } from '../../ai/llm/types';
import type { NativeExpression } from './ExpressionController';

/**
 * LLM `emotion` 在角色身上的落地：一层表情 + 一组 B/C 档微动作。
 *
 * 与 `shortAction` 分工明确——`emotion` 只负责脸（VRM 表情 + 面部/耳朵的 B/C 档微动作），
 * `shortAction` 只负责身体组合动作。所以答复段落播放组合动作时要用
 * `presentation: false`，不要把这个表情层顶掉。
 *
 * 取值参考 `full-body-motion-config.json` 里语义最接近的组合动作，但只保留 B/C 档：
 * 组合动作会带上 A 档（`earTwitch`、`gazeShiftDown`、`ahogeSway`），那是
 * `microdynamicsSchedule` 自动调度的范围，LLM 情绪不该插手。
 */
export interface MoodPresentation {
  /** VRM 原生表情名，键取自 full-body-motion-config.json 的 `expressions`。 */
  expression: NativeExpression;
  /** B/C 档微动作 id，取自 micro-dynamics.json 的 `actions`。 */
  microdynamics: readonly string[];
}

export const MOOD_PRESENTATION: Record<PersonalityMood, MoodPresentation> = {
  neutral: { expression: 'neutral', microdynamics: [] },
  happy: { expression: 'happy', microdynamics: ['smallSmile'] },
  curious: { expression: 'neutral', microdynamics: ['curiousLook', 'earFocus'] },
  concerned: { expression: 'sad', microdynamics: ['browRaise', 'mouthPress'] },
  angry: { expression: 'angry', microdynamics: ['angryBrow', 'earFocus'] },
  sad: { expression: 'sad', microdynamics: ['eyeSquint', 'mouthPress', 'earRelax'] },
  shy: { expression: 'happy', microdynamics: ['shySquint', 'earRelax'] }
};

/** 表情从这一句开始保持，直到下一句覆盖或 `returnToIdle` 收回。 */
export const MOOD_EXPRESSION_DURATION_MS = 900;
/** 即使 intensity 很低也要有一张看得见的脸。 */
const MIN_EXPRESSION_WEIGHT = 0.55;

export interface MoodPresentationTarget {
  expression: { set(id: string, weight: number, duration?: number): unknown };
  microdynamics?: { play(id: string): void };
}

/** 把一句台词的 `emotion` 落到角色脸上：设表情 + 叠加 B/C 档微动作。 */
export function applyMoodPresentation(
  target: MoodPresentationTarget,
  mood: PersonalityMood,
  intensity: number
): void {
  const presentation = MOOD_PRESENTATION[mood];
  const weight = clamp01(MIN_EXPRESSION_WEIGHT + intensity * (1 - MIN_EXPRESSION_WEIGHT));
  void target.expression.set(presentation.expression, weight, MOOD_EXPRESSION_DURATION_MS);
  for (const id of presentation.microdynamics) target.microdynamics?.play(id);
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : MIN_EXPRESSION_WEIGHT;
}
