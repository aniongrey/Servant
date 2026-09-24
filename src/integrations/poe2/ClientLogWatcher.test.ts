import { describe, expect, it, vi } from 'vitest';
import { ClientLogWatcher, type TextFileTailReader } from './ClientLogWatcher';
import type { GameEvent } from '../../event/events/game/types';

describe('ClientLogWatcher', () => {
  it('reads only appended text after startup', async () => {
    vi.useFakeTimers();
    const reader = new MemoryTailReader('old line\n');
    const watcher = new ClientLogWatcher(reader, { pollIntervalMs: 100 });
    const events: GameEvent[] = [];

    await watcher.start((event) => events.push(event));
    reader.append('2026/08/31 20:12:00 123 INFO Client 123 [INFO Client] You have entered Clearfell.\n');
    await watcher.poll();
    watcher.stop();
    vi.useRealTimers();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'AREA_ENTER', area: 'Clearfell' });
  });
});

class MemoryTailReader implements TextFileTailReader {
  constructor(private text: string) {}

  append(value: string): void {
    this.text += value;
  }

  async getSize(): Promise<number> {
    return this.text.length;
  }

  async readFrom(offset: number): Promise<{ text: string; nextOffset: number }> {
    return {
      text: this.text.slice(offset),
      nextOffset: this.text.length
    };
  }
}
