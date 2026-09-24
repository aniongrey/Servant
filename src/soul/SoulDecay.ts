import { normalizeSoulState } from './SoulState';
import type { SoulState } from './types';

export function decaySoulState(state: SoulState, elapsedMs: number, now = Date.now()): SoulState {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return structuredClone(state);
  const minutes = elapsedMs / 60_000;
  const next = structuredClone(state);
  next.mood.happiness *= Math.pow(0.98, minutes);
  next.mood.anger *= Math.pow(0.97, minutes);
  next.mood.sadness *= Math.pow(0.995, minutes);
  next.updatedAt = now;
  return normalizeSoulState(next, now);
}
