import type { SchedulerFile, SchedulerTask } from './SchedulerTypes';

export interface SchedulerRepository {
  load(): Promise<SchedulerTask[]>;
  save(tasks: SchedulerTask[]): Promise<void>;
  quarantine?(): Promise<void>;
}

export function serializeSchedulerFile(tasks: SchedulerTask[]): string {
  return `${JSON.stringify({ version: 1, tasks } satisfies SchedulerFile, null, 2)}\n`;
}

export function parseSchedulerFile(raw: string | null): SchedulerTask[] {
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || value.version !== 1) {
    throw new Error('Invalid scheduler JSON');
  }
  if (Array.isArray(value.tasks)) return value.tasks.filter(isSchedulerTask);
  if (Array.isArray(value.jobs)) return value.jobs.filter(isLegacyReminder).map(migrateLegacyReminder);
  throw new Error('Invalid scheduler JSON');
}

function migrateLegacyReminder(value: Record<string, unknown>): SchedulerTask {
  const scheduledAt = value.scheduledAt as number;
  const message = value.message as string;
  const payload = Object.fromEntries(
    ['action', 'emotion', 'intensity']
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, value[key]])
  );
  return {
    id: value.jobId as string,
    enabled: true,
    name: message.slice(0, 80) || '定时提醒',
    schedule: { type: 'once', at: value.dueAt as number },
    event: {
      type: 'reminder',
      text: typeof value.speech === 'string' && value.speech.trim() ? value.speech : message,
      ...(Object.keys(payload).length > 0 ? { payload } : {})
    },
    nextRunAt: value.dueAt as number,
    createdAt: scheduledAt,
    updatedAt: scheduledAt
  };
}

function isLegacyReminder(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    value.type === 'reminder-scheduled' &&
    typeof value.jobId === 'string' &&
    typeof value.message === 'string' &&
    typeof value.scheduledAt === 'number' &&
    typeof value.dueAt === 'number'
  );
}

function isSchedulerTask(value: unknown): value is SchedulerTask {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.enabled === 'boolean' &&
    typeof value.name === 'string' &&
    isRecord(value.schedule) &&
    (value.schedule.type === 'once' || value.schedule.type === 'daily' || value.schedule.type === 'weekly') &&
    isRecord(value.event) &&
    value.event.type === 'reminder' &&
    typeof value.event.text === 'string' &&
    typeof value.nextRunAt === 'number' &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
