import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MISSED_REMINDER_STORAGE_KEY,
  saveMissedReminder,
  takeMissedReminders
} from './MissedReminderInbox';

describe('MissedReminderInbox', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('deduplicates a missed reminder and consumes it once', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key)
    });
    vi.stubGlobal('window', new EventTarget());
    const reminder = {
      type: 'reminder' as const,
      jobId: 'lunch',
      message: '该干饭了。',
      speech: '该干饭了。',
      scheduledAt: 1,
      dueAt: 2,
      missed: true
    };

    saveMissedReminder(reminder);
    saveMissedReminder(reminder);

    expect(takeMissedReminders()).toEqual([reminder]);
    expect(values.has(MISSED_REMINDER_STORAGE_KEY)).toBe(false);
  });
});
