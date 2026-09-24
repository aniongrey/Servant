import { LocalStorageSoulStorage, MemorySoulStorage, SoulManager } from '../soul';
import type { SoulManagerOptions } from '../soul';

/** @deprecated Import SoulManager from src/soul for new code. */
export class CharacterStateManager extends SoulManager {}

/** @deprecated Import MemorySoulStorage from src/soul for new code. */
export class MemoryCharacterStateStorage extends MemorySoulStorage {}

/** @deprecated Import LocalStorageSoulStorage from src/soul for new code. */
export class LocalStorageCharacterStateStorage extends LocalStorageSoulStorage {}

export function createBrowserSoulManager(characterId = 'shiro'): SoulManager {
  const manager = new SoulManager({ characterId, storage: new LocalStorageSoulStorage() });
  manager.load();
  return manager;
}

/** @deprecated Use createBrowserSoulManager. */
export function createBrowserCharacterStateManager(characterId = 'shiro'): SoulManager {
  return createBrowserSoulManager(characterId);
}

export type CharacterStateManagerOptions = SoulManagerOptions;
