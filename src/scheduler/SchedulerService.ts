import { AsyncTask, CronJob, LongIntervalJob, ToadScheduler } from 'toad-scheduler';
import type { SchedulerRepository } from './SchedulerRepository';
import { calculateNextRun, formatSchedule, scheduleToCron, validateSchedule } from './SchedulerTime';
import type { SchedulerTask, SchedulerTaskInput, SchedulerToolInput } from './SchedulerTypes';

export interface SchedulerTriggerEvent {
  taskId: string;
  task: SchedulerTask;
  dueAt: number;
  missed?: boolean;
}

export class SchedulerService {
  private readonly scheduler = new ToadScheduler();
  private readonly tasks = new Map<string, SchedulerTask>();
  private operations: Promise<unknown> = Promise.resolve();
  private initialized = false;
  private disposed = false;

  constructor(
    private readonly repository: SchedulerRepository,
    private readonly onTrigger: (event: SchedulerTriggerEvent) => void | Promise<void>,
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = () => crypto.randomUUID(),
    private readonly onError: (cause: unknown) => void = console.error
  ) {}

  init(): Promise<void> {
    return this.enqueue(async () => {
      if (this.initialized || this.disposed) return;
      this.initialized = true;
      let loaded: SchedulerTask[];
      try {
        loaded = await this.repository.load();
      } catch (cause) {
        await this.repository.quarantine?.();
        await this.repository.save([]);
        loaded = [];
        this.onError(cause);
      }
      for (const task of loaded) this.tasks.set(task.id, task);
      await this.reconcileInternal(true);
      for (const task of this.tasks.values()) this.registerTask(task);
    }) as Promise<void>;
  }

  reconcile(): Promise<void> {
    return this.enqueue(() => this.reconcileInternal()) as Promise<void>;
  }

  addTask(input: SchedulerTaskInput): Promise<SchedulerTask> {
    return this.enqueue(async () => {
      this.assertReady();
      validateSchedule(input.schedule);
      const timestamp = this.now();
      if (input.schedule.type === 'once' && input.schedule.at <= timestamp) throw new Error('提醒时间必须晚于当前时间。');
      const task: SchedulerTask = {
        id: this.createId(),
        enabled: true,
        name: input.name.trim().slice(0, 80) || input.text.trim().slice(0, 80) || '定时提醒',
        schedule: structuredClone(input.schedule),
        event: { type: 'reminder', text: input.text.trim().slice(0, 500), ...(input.payload ? { payload: input.payload } : {}) },
        nextRunAt: calculateNextRun(input.schedule, timestamp),
        createdAt: timestamp,
        updatedAt: timestamp
      };
      if (!task.event.text) throw new Error('提醒内容不能为空。');
      this.tasks.set(task.id, task);
      await this.persist();
      this.registerTask(task);
      return structuredClone(task);
    }) as Promise<SchedulerTask>;
  }

  updateTask(id: string, patch: Partial<SchedulerTaskInput>): Promise<SchedulerTask> {
    return this.enqueue(async () => {
      this.assertReady();
      const task = this.requireTask(id);
      this.unregisterTask(id);
      if (patch.schedule) {
        validateSchedule(patch.schedule);
        task.schedule = structuredClone(patch.schedule);
      }
      if (patch.name !== undefined) task.name = patch.name.trim().slice(0, 80) || task.name;
      if (patch.text !== undefined) task.event.text = patch.text.trim().slice(0, 500) || task.event.text;
      if (patch.payload !== undefined) task.event.payload = patch.payload;
      task.nextRunAt = calculateNextRun(task.schedule, this.now());
      task.updatedAt = this.now();
      await this.persist();
      this.registerTask(task);
      return structuredClone(task);
    }) as Promise<SchedulerTask>;
  }

  removeTask(id: string): Promise<SchedulerTask> {
    return this.enqueue(async () => {
      this.assertReady();
      const task = this.requireTask(id);
      this.unregisterTask(id);
      this.tasks.delete(id);
      await this.persist();
      return structuredClone(task);
    }) as Promise<SchedulerTask>;
  }

  listTasks(): SchedulerTask[] {
    return [...this.tasks.values()]
      .sort((left, right) => left.nextRunAt - right.nextRunAt)
      .map((task) => structuredClone(task));
  }

  searchTasks(query: string): SchedulerTask[] {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return this.listTasks();
    return this.listTasks().filter((task) =>
      `${task.name} ${task.event.text} ${formatSchedule(task.schedule)}`.toLocaleLowerCase().includes(normalized)
    );
  }

  async executeTool(input: SchedulerToolInput): Promise<unknown> {
    if (input.action === 'add') return this.addTask(input);
    if (input.action === 'update') {
      const candidates = input.taskId ? [this.requireTask(input.taskId)] : this.searchTasks(input.query ?? '');
      if (candidates.length !== 1) {
        throw new Error(candidates.length === 0 ? '没有找到匹配的提醒。' : '找到多个匹配提醒，请提供更具体的名称。');
      }
      return this.updateTask(candidates[0].id, input);
    }
    if (input.action === 'list') return this.searchTasks(input.query ?? '');
    const candidates = input.taskId ? [this.requireTask(input.taskId)] : this.searchTasks(input.query ?? '');
    if (candidates.length !== 1) {
      throw new Error(candidates.length === 0 ? '没有找到匹配的提醒。' : '找到多个匹配提醒，请提供更具体的名称。');
    }
    return this.removeTask(candidates[0].id);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scheduler.stop();
    this.tasks.clear();
  }

  private async reconcileInternal(missed = false): Promise<void> {
    if (this.disposed) return;
    const overdue = [...this.tasks.values()]
      .filter((task) => task.enabled && task.nextRunAt <= this.now())
      .sort((left, right) => left.nextRunAt - right.nextRunAt);
    for (const task of overdue) await this.executeTask(task.id, missed);
  }

  private registerTask(task: SchedulerTask): void {
    if (!task.enabled || this.disposed) return;
    this.unregisterTask(task.id);
    const asyncTask = new AsyncTask(task.id, () => this.enqueue(() => this.executeTask(task.id)), this.onError);
    if (task.schedule.type === 'once') {
      const delay = Math.max(1, task.nextRunAt - this.now());
      this.scheduler.addLongIntervalJob(
        new LongIntervalJob({ milliseconds: delay }, asyncTask, { id: task.id, preventOverrun: true })
      );
      return;
    }
    this.scheduler.addCronJob(
      new CronJob({ cronExpression: scheduleToCron(task.schedule) }, asyncTask, {
        id: task.id,
        preventOverrun: true
      })
    );
  }

  private unregisterTask(id: string): void {
    if (this.scheduler.existsById(id)) this.scheduler.removeById(id);
  }

  private async executeTask(id: string, missed = false): Promise<void> {
    const task = this.tasks.get(id);
    if (!task?.enabled || this.disposed) return;
    const dueAt = task.nextRunAt;
    if (task.schedule.type === 'once') this.unregisterTask(id);
    task.lastRunAt = this.now();
    if (task.schedule.type === 'once') this.tasks.delete(id);
    else task.nextRunAt = calculateNextRun(task.schedule, this.now());
    await this.persist();
    await this.onTrigger({ taskId: id, task: structuredClone(task), dueAt, ...(missed ? { missed: true } : {}) });
  }

  private persist(): Promise<void> {
    return this.repository.save(this.listTasks());
  }

  private requireTask(id: string): SchedulerTask {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`提醒不存在：${id}`);
    return task;
  }

  private assertReady(): void {
    if (!this.initialized || this.disposed) throw new Error('定时服务尚未启动。');
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const next = this.operations.then(operation, operation);
    this.operations = next.catch((cause) => this.onError(cause));
    return next;
  }
}
