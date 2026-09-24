import { liveConfig } from '../../integrations/barrage/config/live.config';
import type { FilterRule } from '../../integrations/barrage/filter/LiveContentFilter';
const LIVE_FILTER_RULES_STORAGE_KEY = 'codex-list.live.filter-rules.v1';

export function loadFilterRules(): FilterRule[] {
  try {
    const saved = localStorage.getItem(LIVE_FILTER_RULES_STORAGE_KEY);
    if (!saved) return [...liveConfig.filter.rules];
    const parsed = JSON.parse(saved) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isFilterRule) : [];
  } catch {
    return [];
  }
}

export function saveFilterRules(rules: FilterRule[]): void {
  localStorage.setItem(LIVE_FILTER_RULES_STORAGE_KEY, JSON.stringify(rules));
}

function isFilterRule(value: unknown): value is FilterRule {
  if (typeof value !== 'object' || value === null) return false;
  const rule = value as Partial<FilterRule>;
  return (
    typeof rule.id === 'string' &&
    (rule.type === 'keyword' || rule.type === 'regex') &&
    typeof rule.value === 'string' &&
    (rule.action === 'hide' || rule.action === 'ignore_ai') &&
    typeof rule.enabled === 'boolean'
  );
}
