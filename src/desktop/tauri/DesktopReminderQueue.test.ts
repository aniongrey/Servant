import { describe, expect, it, vi } from 'vitest';
import { DesktopReminderQueue, type ReminderSyncEvent } from './DesktopReminderQueue';

const reminder = (jobId: string): ReminderSyncEvent => ({
  type: 'reminder',
  jobId,
  message: jobId,
  scheduledAt: 1,
  dueAt: 2
});

describe('DesktopReminderQueue', () => {
  it('waits for active speech and processes reminders in FIFO order', async () => {
    const order: string[] = [];
    const releases: Array<() => void> = [];
    const queue = new DesktopReminderQueue((type, jobId) => order.push(`${type}:${jobId}`));
    queue.setProcessor(
      vi.fn(
        (event) =>
          new Promise<void>((resolve) => {
            order.push(`process:${event.jobId}`);
            releases.push(resolve);
          })
      )
    );
    queue.handleVoiceEvent({ type: 'speech-start', id: 'dialogue-1', text: '上一段对话' });
    queue.handle(reminder('first'));
    queue.handle(reminder('second'));
    await Promise.resolve();
    expect(order).toEqual([]);

    queue.handleVoiceEvent({ type: 'speech-end', id: 'dialogue-1' });
    await vi.waitFor(() => expect(order).toContain('process:first'));
    expect(order).not.toContain('process:second');
    releases.shift()?.();
    await vi.waitFor(() => expect(order).toContain('process:second'));
    releases.shift()?.();
    await vi.waitFor(() => expect(order.at(-1)).toBe('reminder-completed:second'));
  });

  it('deduplicates the same reminder before and after it completes', async () => {
    const processed: string[] = [];
    const queue = new DesktopReminderQueue(() => undefined);
    queue.handleVoiceEvent({ type: 'speech-start', id: 'dialogue', text: 'busy' });
    queue.setProcessor(async (event) => {
      processed.push(event.jobId);
    });
    queue.handle(reminder('same'));
    queue.handle(reminder('same'));
    queue.handleVoiceEvent({ type: 'speech-end', id: 'dialogue' });
    await vi.waitFor(() => expect(processed).toEqual(['same']));
    queue.handle(reminder('same'));
    await Promise.resolve();
    expect(processed).toEqual(['same']);
  });

  it('unblocks queued reminders when conversation speech is canceled', async () => {
    const processed: string[] = [];
    const queue = new DesktopReminderQueue(() => undefined);
    queue.setProcessor(async (event) => {
      processed.push(event.jobId);
    });
    queue.handleVoiceEvent({ type: 'speech-start', id: 'dialogue', text: '正在说话', source: 'conversation' });
    queue.handle(reminder('after-cancel'));
    await Promise.resolve();
    expect(processed).toEqual([]);

    queue.handleVoiceEvent({ type: 'speech-cancel', id: 'dialogue', source: 'conversation' });
    await vi.waitFor(() => expect(processed).toEqual(['after-cancel']));
  });
});
