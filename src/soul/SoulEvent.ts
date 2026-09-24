import { createSoulEventId } from './SoulState';
import type { SoulEvent, SoulEventType } from './types';

export function createSoulEvent(type: SoulEventType, description: string, timestamp = Date.now()): SoulEvent {
  return { id: createSoulEventId(), type, description: description.trim(), timestamp };
}
