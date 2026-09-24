import bundled from '../assets/actions/full-body-motion-config.json' with { type: 'json' };
import micro from '../../micro-dynamics/micro-dynamics.json' with { type: 'json' };
import type { VrmaSegmentConfig } from '../assets/vrmaSegments.ts';

export type FullBodyConfig = typeof bundled;
export type EmotionDefinition = FullBodyConfig['emotion'][keyof FullBodyConfig['emotion']];

export function findEmotionSegment(ref: EmotionDefinition['vrma'], segments: VrmaSegmentConfig) {
  if (!ref || !Number.isInteger(ref.start) || !Number.isInteger(ref.end) || ref.start < 0 || ref.end < ref.start)
    return undefined;
  return segments[ref.file]?.find((segment) => segment.description === ref.description &&
    segment.start === ref.start && segment.end === ref.end) ??
    segments[ref.file]?.find((segment) => segment.description === ref.description &&
      segment.start <= ref.start && segment.end >= ref.end);
}

export function validateEmotionConfig(value: unknown, segments: VrmaSegmentConfig): FullBodyConfig {
  const config = value as FullBodyConfig;
  if (!config || typeof config !== 'object' || !config.emotion || !config.expressions)
    throw new Error('缺少 emotion / expressions');
  const ids = new Set(micro.actions.map((action) => action.id));
  if (!Array.isArray(config.microdynamics) || config.microdynamics.some((id) => !ids.has(id)))
    throw new Error('未知微动作');
  for (const [id, definition] of Object.entries(config.emotion)) {
    if (!definition || typeof definition.purpose !== 'string' || !definition.purpose.trim() ||
      !Object.hasOwn(config.expressions, definition.expression) ||
      !Array.isArray(definition.microdynamics) || definition.microdynamics.some((name) => !ids.has(name)) ||
      !findEmotionSegment(definition.vrma, segments))
      throw new Error(`无效 emotion 配置：${id}`);
  }
  if (!Object.hasOwn(config.emotion, config.speaking)) throw new Error('speaking 必须引用 emotion ID');
  for (const range of [config.idleDelaySeconds, config.interactionProtectionSeconds])
    if (!Array.isArray(range) || range.length !== 2 || range.some((n) => !Number.isFinite(n) || n < 0) || range[1] < range[0])
      throw new Error('时间范围无效');
  if (!Number.isFinite(config.crossfadeSeconds) || config.crossfadeSeconds < 0) throw new Error('crossfadeSeconds 无效');
  if (!config.microdynamicsSchedule || typeof config.microdynamicsSchedule.enabled !== 'boolean' || !Array.isArray(config.microdynamicsSchedule.rules))
    throw new Error('微动作调度无效');
  for (const rule of config.microdynamicsSchedule.rules)
    if (!micro.actions.some((action) => action.id === rule.action && action.tier === 'A') ||
      !Array.isArray(rule.intervalMs) || rule.intervalMs.length !== 2 || rule.intervalMs.some((n) => !Number.isFinite(n) || n <= 0) ||
      rule.intervalMs[1] < rule.intervalMs[0] || !Number.isFinite(rule.probability) || rule.probability < 0 || rule.probability > 1)
      throw new Error('A 层调度规则无效');
  return config;
}
