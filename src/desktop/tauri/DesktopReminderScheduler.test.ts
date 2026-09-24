import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SchedulerRepository } from '../../scheduler/SchedulerRepository';
import type { SchedulerTask, ToolResultEvent } from '../../scheduler/SchedulerTypes';
import { DesktopReminderScheduler } from './DesktopReminderScheduler';

class MemorySchedulerRepository implements SchedulerRepository {
  constructor(public tasks: SchedulerTask[] = []) {}
  async load() { return structuredClone(this.tasks); }
  async save(tasks: SchedulerTask[]) { this.tasks = structuredClone(tasks); }
}

const task = (id: string, at: number): SchedulerTask => ({
  id,
  enabled: true,
  name: `提醒 ${id}`,
  schedule: { type: 'once', at },
  event: { type: 'reminder', text: `内容 ${id}` },
  nextRunAt: at,
  createdAt: 10,
  updatedAt: 10
});

describe('DesktopReminderScheduler', () => {
  beforeEach(() => {
    const target = new EventTarget() as EventTarget & Pick<Window, 'setInterval' | 'clearInterval'>;
    target.setInterval = vi.fn(() => 1) as unknown as Window['setInterval'];
    target.clearInterval = vi.fn();
    vi.stubGlobal('window', target);
    const documentTarget = new EventTarget() as EventTarget & { visibilityState: string };
    documentTarget.visibilityState = 'visible';
    vi.stubGlobal('document', documentTarget);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('loads JSON tasks and delivers an overdue once task exactly once', async () => {
    const repository = new MemorySchedulerRepository([task('overdue', 50), task('future', 200)]);
    const delivered: string[] = [];
    const scheduler = new DesktopReminderScheduler(repository, (event) => delivered.push(event.jobId), () => 100);
    await scheduler.start();
    await scheduler.reloadAndCheck();
    expect(delivered).toEqual(['overdue']);
    expect(repository.tasks.map((item) => item.id)).toEqual(['future']);
    scheduler.dispose();
  });

  it('marks a missed lunch reminder for the chat flow on the next start', async () => {
    const repository = new MemorySchedulerRepository([
      { ...task('lunch', new Date(2026, 0, 1, 12).getTime()), event: { type: 'reminder', text: '该干饭了。' } }
    ]);
    const delivered: Array<{ message: string }> = [];
    const scheduler = new DesktopReminderScheduler(
      repository,
      (event) => delivered.push(event),
      () => new Date(2026, 0, 1, 13).getTime()
    );

    await scheduler.start();

    expect(delivered).toEqual([expect.objectContaining({ message: '该干饭了。', missed: true })]);
    scheduler.dispose();
  });

  it('executes add, list and remove tool commands with usable result speech', async () => {
    const repository = new MemorySchedulerRepository();
    const results: ToolResultEvent[] = [];
    const scheduler = new DesktopReminderScheduler(
      repository,
      () => undefined,
      () => 100,
      console.error,
      (event) => results.push(event),
      () => 'created-task'
    );
    await scheduler.start();
    await scheduler.handle({
      type: 'scheduler-command',
      requestId: 'add-1',
      input: { action: 'add', name: '喝水', schedule: { type: 'once', at: 500 }, text: '喝水' }
    });
    await scheduler.handle({ type: 'scheduler-command', requestId: 'list-1', input: { action: 'list' } });
    await scheduler.handle({
      type: 'scheduler-command',
      requestId: 'remove-1',
      input: { action: 'remove', taskId: 'created-task' }
    });

    expect(results.map((event) => [event.action, event.success])).toEqual([
      ['add', true],
      ['list', true],
      ['remove', true]
    ]);
    expect(results[0].speech).toContain('已设置「喝水」提醒');
    expect(results[1].speech).toContain('当前有 1 个提醒：');
    expect(results[2].speech).toBe('已取消「喝水」提醒。');
    expect(repository.tasks).toEqual([]);
    scheduler.dispose();
  });

  it('returns a fixed failure result instead of throwing tool errors', async () => {
    const results: ToolResultEvent[] = [];
    const scheduler = new DesktopReminderScheduler(
      new MemorySchedulerRepository(),
      () => undefined,
      () => 100,
      console.error,
      (event) => results.push(event)
    );
    await scheduler.start();
    await scheduler.handle({
      type: 'scheduler-command',
      requestId: 'remove-missing',
      input: { action: 'remove', query: '不存在' }
    });
    expect(results[0]).toMatchObject({ success: false, speech: '定时操作失败了。' });
    scheduler.dispose();
  });
});
