import type { RuntimeContext } from '../app/runtimeTypes';

const CONDITION_PATTERN = /^\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*(>=|<=|>|<|===|==|!=)\s*(-?\d+(?:\.\d+)?)\s*$/;

export function evaluateCondition(condition: string, context: RuntimeContext): boolean {
  const trimmed = condition.trim();
  const match = CONDITION_PATTERN.exec(trimmed);

  if (!match) {
    return Boolean(resolveValue(trimmed, context));
  }

  const [, key, operator, rawExpected] = match;
  const actual = Number(resolveValue(key, context));
  const expected = Number(rawExpected);

  switch (operator) {
    case '>=':
      return actual >= expected;
    case '<=':
      return actual <= expected;
    case '>':
      return actual > expected;
    case '<':
      return actual < expected;
    case '===':
    case '==':
      return actual === expected;
    case '!=':
      return actual !== expected;
    default:
      return false;
  }
}

function resolveValue(path: string, context: RuntimeContext): number | boolean | undefined {
  if (path in context.counters) {
    return context.counters[path];
  }

  if (path in context.emotions) {
    return context.emotions[path as keyof RuntimeContext['emotions']];
  }

  if (path in context.relationship) {
    return context.relationship[path as keyof RuntimeContext['relationship']];
  }

  if (path in context.personality) {
    return context.personality[path as keyof RuntimeContext['personality']];
  }

  const parts = path.split('.');
  let cursor: unknown = context;

  for (const part of parts) {
    if (typeof cursor !== 'object' || cursor === null || !(part in cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }

  if (typeof cursor === 'number' || typeof cursor === 'boolean') {
    return cursor;
  }

  return undefined;
}
