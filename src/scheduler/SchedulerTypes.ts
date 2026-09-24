export type ScheduleType = 'once' | 'daily' | 'weekly';

export interface OnceSchedule {
  type: 'once';
  at: number;
}

export interface DailySchedule {
  type: 'daily';
  hour: number;
  minute: number;
}

export interface WeeklySchedule {
  type: 'weekly';
  weekdays: number[];
  hour: number;
  minute: number;
}

export type SchedulerSchedule = OnceSchedule | DailySchedule | WeeklySchedule;

export interface SchedulerTask {
  id: string;
  enabled: boolean;
  name: string;
  schedule: SchedulerSchedule;
  event: {
    type: 'reminder';
    text: string;
    payload?: Record<string, unknown>;
  };
  nextRunAt: number;
  lastRunAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface SchedulerTaskInput {
  name: string;
  schedule: SchedulerSchedule;
  text: string;
  payload?: Record<string, unknown>;
}

export type SchedulerToolInput =
  | ({ action: 'add' } & SchedulerTaskInput)
  | { action: 'update'; taskId?: string; query?: string; name?: string; schedule?: SchedulerSchedule; text?: string }
  | { action: 'remove'; taskId?: string; query?: string }
  | { action: 'list'; query?: string };

export interface SchedulerFile {
  version: 1;
  tasks: SchedulerTask[];
}

export type ToolName = 'scheduler' | 'web-search';

export interface ToolResultEvent {
  type: 'tool-result';
  requestId: string;
  tool: ToolName;
  action: string;
  success: boolean;
  speech: string;
  content?: unknown;
  error?: string;
}

export interface SchedulerCommandEvent {
  type: 'scheduler-command';
  requestId: string;
  input: SchedulerToolInput;
}
