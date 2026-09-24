import type { SchedulerToolInput } from './SchedulerTypes';

const UNIX_MILLISECONDS_THRESHOLD = 100_000_000_000;
const RELATIVE_TIME_PATTERN =
  /(\d+(?:\.\d+)?|半|[一二两三四五六七八九十百]+)\s*(?:个)?\s*(秒(?:钟)?|分钟|分|小时|钟头|天)\s*(?:之)?后/;

/** Normalizes model-produced scheduler arguments before they cross into the strict scheduler domain. */
export function normalizeSchedulerToolInput(
  input: SchedulerToolInput,
  userText: string,
  now: number = Date.now()
): SchedulerToolInput {
  if (input.action !== 'add' && input.action !== 'update') return structuredClone(input);
  if (!input.schedule || input.schedule.type !== 'once') return structuredClone(input);

  const relativeDelay = readRelativeDelay(userText);
  const at = relativeDelay === null ? normalizeUnixMilliseconds(input.schedule.at) : now + relativeDelay;
  return {
    ...structuredClone(input),
    schedule: { ...input.schedule, at }
  };
}

export function normalizeUnixMilliseconds(value: number): number {
  return value > 0 && value < UNIX_MILLISECONDS_THRESHOLD ? value * 1_000 : value;
}

export function readRelativeDelay(text: string): number | null {
  const match = text.match(RELATIVE_TIME_PATTERN);
  if (!match) return null;
  const amount = readNumber(match[1]);
  if (amount === null || amount <= 0) return null;
  const unit = match[2];
  const multiplier = unit.startsWith('秒')
    ? 1_000
    : unit === '分钟' || unit === '分'
    ? 60_000
    : unit === '天'
    ? 86_400_000
    : 3_600_000;
  return amount * multiplier;
}

function readNumber(value: string): number | null {
  if (value === '半') return 0.5;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return readChineseInteger(value);
}

function readChineseInteger(value: string): number | null {
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  };
  let total = 0;
  let current = 0;
  for (const character of value) {
    if (character in digits) {
      current = digits[character];
      continue;
    }
    if (character === '十') {
      total += (current || 1) * 10;
      current = 0;
      continue;
    }
    if (character === '百') {
      total += (current || 1) * 100;
      current = 0;
      continue;
    }
    return null;
  }
  return total + current || null;
}
