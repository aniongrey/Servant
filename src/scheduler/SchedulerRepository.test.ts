import { describe, expect, it } from 'vitest';
import { parseSchedulerFile, serializeSchedulerFile } from './SchedulerRepository';

describe('SchedulerRepository format', () => {
  it('migrates V1 reminder jobs without losing pending reminders', () => {
    const tasks = parseSchedulerFile(JSON.stringify({
      version: 1,
      jobs: [{
        type: 'reminder-scheduled',
        jobId: 'legacy-1',
        message: '喝水',
        speech: '该喝水了',
        scheduledAt: 100,
        dueAt: 500
      }]
    }));
    expect(tasks[0]).toMatchObject({
      id: 'legacy-1',
      schedule: { type: 'once', at: 500 },
      event: { text: '该喝水了' }
    });
    expect(serializeSchedulerFile(tasks)).toContain('"tasks"');
  });
});
