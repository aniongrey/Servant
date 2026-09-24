import type { SoulState } from './types';

export function describeSoulState(state: SoulState): string {
  const recentEvents = state.recentEvents.length
    ? state.recentEvents.map((event) => `- ${event.description}`).join('\n')
    : '- 无';
  return [
    '[Current Soul State]',
    `开心：${moodLevel(state.mood.happiness)}`,
    `生气：${moodLevel(state.mood.anger)}`,
    `难过：${moodLevel(state.mood.sadness)}`,
    '',
    `亲密度：${relationLevel(state.relation.intimacy)}`,
    `信任度：${relationLevel(state.relation.trust)}`,
    `当前需求：${state.currentNeed}`,
    '',
    '[Recent Events]',
    recentEvents,
    '',
    'SoulState 是角色当前真实状态。根据角色人格与该状态决定说什么、使用什么情绪表现和语义动作；不要擅自修改或声明修改这些数值。'
  ].join('\n');
}

export function moodLevel(value: number): string {
  if (value < 0) return value <= -40 ? '明显低落' : '轻微低落';
  if (value >= 70) return '很强';
  if (value >= 40) return '明显';
  if (value >= 15) return '轻微';
  return '无明显情绪';
}

export function relationLevel(value: number): string {
  if (value >= 80) return '很高';
  if (value >= 55) return '较高';
  if (value >= 30) return '逐渐建立';
  return '较低';
}
