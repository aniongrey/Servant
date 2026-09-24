import type { LiveEvent, LivePlatform } from '../events/LiveEvent';

export type BlacklistMode = 'ignore' | 'no_ai_response';

export interface BlacklistEntry {
  platform: LivePlatform;
  userId: string;
  mode: BlacklistMode;
  reason?: string;
  createdAt: number;
  expiresAt?: number;
}

export interface BlacklistStorage {
  load(): Promise<BlacklistEntry[]>;
  save(entries: BlacklistEntry[]): Promise<void>;
}

export class MemoryBlacklistStorage implements BlacklistStorage {
  constructor(private entries: BlacklistEntry[] = []) {}

  async load(): Promise<BlacklistEntry[]> {
    return [...this.entries];
  }

  async save(entries: BlacklistEntry[]): Promise<void> {
    this.entries = [...entries];
  }
}

export class LocalStorageBlacklistStorage implements BlacklistStorage {
  constructor(private readonly key = 'codex-list.live.blacklist.v1') {}

  async load(): Promise<BlacklistEntry[]> {
    if (typeof localStorage === 'undefined') return [];
    try {
      const text = localStorage.getItem(this.key);
      return text ? normalizeEntries(JSON.parse(text)) : [];
    } catch {
      return [];
    }
  }

  async save(entries: BlacklistEntry[]): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(this.key, JSON.stringify(entries, null, 2));
  }
}

export class BlacklistManager {
  private entries = new Map<string, BlacklistEntry>();

  constructor(private readonly storage: BlacklistStorage = new MemoryBlacklistStorage()) {}

  async load(): Promise<void> {
    this.entries.clear();
    for (const entry of normalizeEntries(await this.storage.load())) {
      if (!isExpired(entry)) this.entries.set(entryKey(entry.platform, entry.userId), entry);
    }
  }

  async add(entry: Omit<BlacklistEntry, 'createdAt'> & { createdAt?: number }): Promise<void> {
    this.entries.set(entryKey(entry.platform, entry.userId), {
      ...entry,
      createdAt: entry.createdAt ?? Date.now()
    });
    await this.save();
  }

  async remove(platform: LivePlatform, userId: string): Promise<void> {
    this.entries.delete(entryKey(platform, userId));
    await this.save();
  }

  has(platform: LivePlatform, userId: string): boolean {
    return this.getEntry(platform, userId) !== undefined;
  }

  getMode(platform: LivePlatform, userId: string): BlacklistMode | undefined {
    return this.getEntry(platform, userId)?.mode;
  }

  getAll(): BlacklistEntry[] {
    this.pruneExpired();
    return [...this.entries.values()];
  }

  apply(event: LiveEvent): { action: 'allow' | 'drop'; event?: LiveEvent; reason?: string } {
    if (!event.user) return { action: 'allow', event };
    const entry = this.getEntry(event.platform, event.user.id);
    if (!entry) return { action: 'allow', event };
    if (entry.mode === 'ignore') return { action: 'drop', reason: entry.reason ?? 'blacklist.ignore' };
    return {
      action: 'allow',
      event: {
        ...event,
        metadata: {
          ...event.metadata,
          noAiResponse: true
        }
      },
      reason: entry.reason ?? 'blacklist.no_ai_response'
    };
  }

  private getEntry(platform: LivePlatform, userId: string): BlacklistEntry | undefined {
    const key = entryKey(platform, userId);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (isExpired(entry)) {
      this.entries.delete(key);
      void this.save();
      return undefined;
    }
    return entry;
  }

  private pruneExpired(): void {
    for (const [key, entry] of this.entries) {
      if (isExpired(entry)) this.entries.delete(key);
    }
  }

  private async save(): Promise<void> {
    this.pruneExpired();
    await this.storage.save([...this.entries.values()]);
  }
}

function entryKey(platform: LivePlatform, userId: string): string {
  return `${platform}:${userId}`;
}

function isExpired(entry: BlacklistEntry): boolean {
  return entry.expiresAt !== undefined && Date.now() > entry.expiresAt;
}

function normalizeEntries(value: unknown): BlacklistEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isBlacklistEntry);
}

function isBlacklistEntry(value: unknown): value is BlacklistEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entry = value as Partial<BlacklistEntry>;
  return (
    typeof entry.platform === 'string' &&
    typeof entry.userId === 'string' &&
    (entry.mode === 'ignore' || entry.mode === 'no_ai_response') &&
    typeof entry.createdAt === 'number'
  );
}
