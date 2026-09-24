import { describe, expect, it, vi } from 'vitest';
import type { SchedulerRepository } from './SchedulerRepository';
import { SchedulerService } from './SchedulerService';
import type { SchedulerTask } from './SchedulerTypes';

class MemoryRepository implements SchedulerRepository {
  quarantined = false;
  constructor(public tasks: SchedulerTask[] = [], private readonly broken = false) {}
  async load() {
    if (this.broken) throw new Error('broken json');
    return structuredClone(this.tasks);
  }
  async save(tasks: SchedulerTask[]) { this.tasks = structuredClone(tasks); }
  async quarantine() { this.quarantined = true; }
}

describe('SchedulerService', () => {
  it('persists add, update, search and remove operations', async () => {
    const repository = new MemoryRepository();
    let sequence = 0;
    const service = new SchedulerService(repository, () => undefined, () => 100, () => `task-${++sequence}`);
    await service.init();
    const added = await service.addTask({
      name: '喝水提醒',
      schedule: { type: 'once', at: 1_000 },
      text: '喝水'
    });
    expect(repository.tasks).toHaveLength(1);
    expect(service.searchTasks('喝水')[0].id).toBe(added.id);

    const updated = await service.updateTask(added.id, {
      schedule: { type: 'daily', hour: 20, minute: 30 },
      text: '休息'
    });
    expect(updated.schedule).toEqual({ type: 'daily', hour: 20, minute: 30 });
    expect(repository.tasks[0].event.text).toBe('休息');

    await service.removeTask(added.id);
    expect(service.listTasks()).toEqual([]);
    expect(repository.tasks).toEqual([]);
    service.dispose();
  });

  it('repairs a corrupt repository and starts with an empty task list', async () => {
    const repository = new MemoryRepository([], true);
    const onError = vi.fn();
    const service = new SchedulerService(repository, () => undefined, Date.now, undefined, onError);
    await service.init();
    expect(repository.quarantined).toBe(true);
    expect(repository.tasks).toEqual([]);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    service.dispose();
  });
});
