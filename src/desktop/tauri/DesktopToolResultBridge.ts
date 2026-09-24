import type { ToolResultEvent } from '../../scheduler/SchedulerTypes';
import type { ReminderSyncEvent } from './DesktopReminderQueue';

/** Raw search results stay silent; their character-authored summary uses the conversation speech stream. */
export function toToolResultSpeechEvent(
  event: ToolResultEvent,
  now: number = Date.now()
): ReminderSyncEvent | undefined {
  if (event.tool === 'web-search' && event.success) return undefined;
  const speech = event.speech.trim();
  if (!speech) return undefined;
  return {
    type: 'reminder',
    jobId: `tool-${event.requestId}`,
    message: '',
    speech,
    scheduledAt: now,
    dueAt: now
  };
}
