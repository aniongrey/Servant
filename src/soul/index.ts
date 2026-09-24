export { SoulManager, type SoulManagerOptions } from './SoulManager';
export { createSoulEvent } from './SoulEvent';
export { decaySoulState } from './SoulDecay';
export { describeSoulState, moodLevel, relationLevel } from './SoulPrompt';
export { soulNeedLabels } from './SoulNeed';
export { DEFAULT_SOUL_STATE, createDefaultSoulState, normalizeSoulState } from './SoulState';
export { LocalStorageSoulStorage, MemorySoulStorage } from './SoulStorage';
export type { SoulEvent, SoulEventType, SoulNeed, SoulState, SoulStateStorage } from './types';
