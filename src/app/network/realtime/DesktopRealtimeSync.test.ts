import { describe, expect, it } from 'vitest';
import { parseDesktopRealtimeSyncEvent } from './DesktopRealtimeSync';

describe('parseDesktopRealtimeSyncEvent', () => {
  it('accepts character refresh and status events', () => {
    expect(parseDesktopRealtimeSyncEvent({ type: 'character-settings-changed' })).toEqual({
      type: 'character-settings-changed'
    });
    expect(
      parseDesktopRealtimeSyncEvent({
        type: 'character-status',
        statuses: ['thinking', 'searching', 'searching']
      })
    ).toEqual({ type: 'character-status', statuses: ['thinking', 'searching'] });
  });

  it('accepts reminder lifecycle events', () => {
    expect(
      parseDesktopRealtimeSyncEvent({
        type: 'reminder',
        jobId: 'job-1',
        message: '休息一下。',
        scheduledAt: 10,
        dueAt: 20
      })
    ).toEqual({
      type: 'reminder',
      jobId: 'job-1',
      message: '休息一下。',
      scheduledAt: 10,
      dueAt: 20
    });
    expect(parseDesktopRealtimeSyncEvent({ type: 'reminder-started', jobId: 'job-1' })).toEqual({
      type: 'reminder-started',
      jobId: 'job-1'
    });
    expect(parseDesktopRealtimeSyncEvent({ type: 'reminder-completed', jobId: 'job-1' })).toEqual({
      type: 'reminder-completed',
      jobId: 'job-1'
    });
  });

  it('rejects voice stream events and malformed events', () => {
    expect(
      parseDesktopRealtimeSyncEvent({
        type: 'reply-stream-start',
        id: 'stream',
        source: 'conversation',
        segment: {
          text: '第一段',
          spokenText: '第一段',
          emotion: 'happy',
          intensity: 0.7,
          shortAction: 'stunned'
        }
      })
    ).toBeUndefined();
    expect(parseDesktopRealtimeSyncEvent({ type: 'speech-start', id: '1', text: '你好' })).toBeUndefined();
    expect(
      parseDesktopRealtimeSyncEvent({ type: 'character-status', statuses: ['thinking', 'unknown'] })
    ).toBeUndefined();
    expect(parseDesktopRealtimeSyncEvent({ type: 'unknown' })).toBeUndefined();
  });

  it('accepts scheduler commands and unified tool results', () => {
    expect(
      parseDesktopRealtimeSyncEvent({
        type: 'scheduler-command',
        requestId: 'scheduler-1',
        input: { action: 'list' }
      })
    ).toEqual({ type: 'scheduler-command', requestId: 'scheduler-1', input: { action: 'list' } });
    expect(
      parseDesktopRealtimeSyncEvent({
        type: 'tool-result',
        requestId: 'scheduler-1',
        tool: 'scheduler',
        action: 'list',
        success: true,
        speech: '提醒列表已经整理好了。',
        content: []
      })
    ).toMatchObject({ type: 'tool-result', requestId: 'scheduler-1', success: true });
  });
});
