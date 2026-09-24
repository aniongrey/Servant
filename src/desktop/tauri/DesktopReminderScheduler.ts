import type { DesktopRealtimeSyncEvent } from '../../app/network/realtime/DesktopRealtimeSync';
import { SchedulerService } from '../../scheduler/SchedulerService';
import { formatSchedule } from '../../scheduler/SchedulerTime';
import {
  parseSchedulerFile,
  serializeSchedulerFile,
  type SchedulerRepository
} from '../../scheduler/SchedulerRepository';
import type { SchedulerTask, SchedulerToolInput, ToolResultEvent } from '../../scheduler/SchedulerTypes';
import { isTauriDesktop } from './navigation';

export type ReminderJobStore = SchedulerRepository;

const STORAGE_KEY = 'codex-list.scheduler.v1';
export class DesktopReminderScheduler {
  private readonly service: SchedulerService;
  private started = false;
  private disposed = false;
  private reconcileTimer?: number;

  constructor(
    store: SchedulerRepository,
    private readonly onDue: (event: DesktopRealtimeSyncEvent & { type: 'reminder' }) => void,
    now: () => number = Date.now,
    private readonly onError: (cause: unknown) => void = console.error,
    private readonly onToolResult: (event: ToolResultEvent) => void = () => undefined,
    createId?: () => string
  ) {
    this.service = new SchedulerService(
      store,
      ({ taskId, task, dueAt, missed }) => this.onDue(toReminderEvent(taskId, task, dueAt, missed === true)),
      now,
      createId,
      onError
    );
  }

  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    window.addEventListener('focus', this.handleWake);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    await this.service.init();
    this.reconcileTimer = window.setInterval(() => void this.service.reconcile(), 60_000);
  }

  async handle(event: DesktopRealtimeSyncEvent): Promise<void> {
    if (this.disposed) return;
    if (event.type === 'scheduler-command') {
      await this.executeCommand(event.requestId, event.input);
      return;
    }
  }

  reloadAndCheck(): Promise<void> {
    return this.service.reconcile();
  }

  listTasks(): SchedulerTask[] {
    return this.service.listTasks();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('focus', this.handleWake);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    if (this.reconcileTimer !== undefined) window.clearInterval(this.reconcileTimer);
    this.service.dispose();
  }

  private readonly handleWake = () => {
    void this.reloadAndCheck().catch(this.onError);
  };

  private readonly handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') this.handleWake();
  };

  private async executeCommand(requestId: string, input: SchedulerToolInput): Promise<void> {
    try {
      const content = await this.service.executeTool(input);
      this.onToolResult({
        type: 'tool-result',
        requestId,
        tool: 'scheduler',
        action: input.action,
        success: true,
        speech: describeToolSuccess(input.action, content),
        content
      });
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : '定时操作失败。';
      this.onToolResult({
        type: 'tool-result',
        requestId,
        tool: 'scheduler',
        action: input.action,
        success: false,
        speech: '定时操作失败了。',
        error
      });
    }
  }
}

function describeToolSuccess(action: SchedulerToolInput['action'], content: unknown): string {
  if (action === 'list') {
    const tasks = content as SchedulerTask[];
    if (tasks.length === 0) return '当前没有待执行的提醒。';
    return `当前有 ${tasks.length} 个提醒：${tasks.map((task) => `「${task.name}」${formatSchedule(task.schedule)}`).join('；')}。`;
  }
  const task = content as SchedulerTask;
  if (action === 'remove') return `已取消「${task.name}」提醒。`;
  if (action === 'add') return `已设置「${task.name}」提醒，${formatSchedule(task.schedule)}。`;
  return `已修改「${task.name}」提醒，${formatSchedule(task.schedule)}。`;
}

export function createDefaultReminderJobStore(): SchedulerRepository {
  return isTauriDesktop() ? new TauriSchedulerRepository() : new BrowserSchedulerRepository();
}

class BrowserSchedulerRepository implements SchedulerRepository {
  async load(): Promise<SchedulerTask[]> {
    return parseSchedulerFile(localStorage.getItem(STORAGE_KEY));
  }

  async save(tasks: SchedulerTask[]): Promise<void> {
    localStorage.setItem(STORAGE_KEY, serializeSchedulerFile(tasks));
  }

  async quarantine(): Promise<void> {
    const broken = localStorage.getItem(STORAGE_KEY);
    if (broken) localStorage.setItem(`${STORAGE_KEY}.broken.${Date.now()}`, broken);
    localStorage.removeItem(STORAGE_KEY);
  }
}

class TauriSchedulerRepository implements SchedulerRepository {
  async load(): Promise<SchedulerTask[]> {
    const { invoke } = await import('@tauri-apps/api/core');
    return parseSchedulerFile(await invoke<string | null>('load_reminder_jobs'));
  }

  async save(tasks: SchedulerTask[]): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('save_reminder_jobs', { content: serializeSchedulerFile(tasks) });
  }

  async quarantine(): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('quarantine_reminder_jobs');
  }
}

function toReminderEvent(
  jobId: string,
  task: SchedulerTask,
  dueAt: number,
  missed: boolean
): DesktopRealtimeSyncEvent & { type: 'reminder' } {
  const payload = task.event.payload;
  return {
    type: 'reminder',
    jobId,
    message: task.event.text,
    speech: task.event.text,
    ...(typeof payload?.action === 'string' ? { action: payload.action } : {}),
    ...(typeof payload?.emotion === 'string' ? { emotion: payload.emotion } : {}),
    ...(typeof payload?.intensity === 'number' ? { intensity: payload.intensity } : {}),
    ...(missed ? { missed: true } : {}),
    scheduledAt: task.createdAt,
    dueAt
  };
}
