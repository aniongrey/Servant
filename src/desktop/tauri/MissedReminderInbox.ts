import type { DesktopRealtimeSyncEvent } from '../../app/network/realtime/DesktopRealtimeSync';

export const MISSED_REMINDER_STORAGE_KEY = 'codex-list.missedReminders.v1';
export const MISSED_REMINDERS_CHANGED_EVENT = 'codex-list:missed-reminders';
type MissedReminder = Extract<DesktopRealtimeSyncEvent, { type: 'reminder' }>;

export function saveMissedReminder(event: MissedReminder): void {
  const reminders = readMissedReminders().filter(
    (item) => item.jobId !== event.jobId || item.dueAt !== event.dueAt
  );
  localStorage.setItem(MISSED_REMINDER_STORAGE_KEY, JSON.stringify([...reminders, event].slice(-20)));
  window.dispatchEvent(new Event(MISSED_REMINDERS_CHANGED_EVENT));
}

export function takeMissedReminders(): MissedReminder[] {
  const reminders = readMissedReminders();
  localStorage.removeItem(MISSED_REMINDER_STORAGE_KEY);
  return reminders;
}

function readMissedReminders(): MissedReminder[] {
  try {
    const value = JSON.parse(localStorage.getItem(MISSED_REMINDER_STORAGE_KEY) ?? '[]') as unknown[];
    return value.flatMap((item) =>
      item && typeof item === 'object' && (item as { type?: unknown }).type === 'reminder' &&
      typeof (item as { jobId?: unknown }).jobId === 'string' &&
      typeof (item as { message?: unknown }).message === 'string' &&
      typeof (item as { dueAt?: unknown }).dueAt === 'number' &&
      typeof (item as { scheduledAt?: unknown }).scheduledAt === 'number'
        ? [item as MissedReminder]
        : []
    );
  } catch {
    return [];
  }
}
