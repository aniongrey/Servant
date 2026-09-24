import { describe, expect, it } from 'vitest';
import { selectRelevantMemories, type MemoryEntry } from './memoryService';

const entry = (overrides: Partial<MemoryEntry>): MemoryEntry => ({
  summary: 'memory',
  event_time_start: null,
  created_at: '2026-01-01T00:00:00.000Z',
  ...overrides
});

describe('selectRelevantMemories', () => {
  it('keeps relevant or important memories and caps context size', () => {
    const selected = selectRelevantMemories([
      entry({ summary: 'irrelevant', score: 0.2, importance: 0.3 }),
      entry({ summary: 'important', score: 0.2, importance: 0.9 }),
      entry({ summary: 'similar', score: 0.9, importance: 0.2 })
    ]);
    expect(selected.map(({ summary }) => summary)).toEqual(['similar', 'important']);
  });
});
