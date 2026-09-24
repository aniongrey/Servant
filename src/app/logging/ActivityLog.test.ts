import { describe, expect, it, vi } from 'vitest';
import { ActivityLog } from './ActivityLog';

describe('ActivityLog', () => {
  it('persists an event and reads one day from the memory service', async () => {
    const networkFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{"recorded":1}', { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            events: [
              {
                id: 'event-1',
                at: 42,
                day: '1970-01-01',
                channel: 'runtime',
                status: 'error',
                message: 'boom'
              }
            ]
          }),
          { status: 200 }
        )
      );
    const log = new ActivityLog(
      networkFetch,
      () => 42,
      () => 'event-1'
    );

    log.record({ channel: 'runtime', status: 'error', message: 'boom' });
    await log.flush();
    const events = await log.list('1970-01-01');

    expect(JSON.parse(String(networkFetch.mock.calls[0][1]?.body))).toMatchObject({
      event: { id: 'event-1', channel: 'runtime', message: 'boom' }
    });
    expect(networkFetch.mock.calls[1][0]).toContain('?day=1970-01-01');
    expect(events[0].message).toBe('boom');
  });

  // The first event of a session is recorded before the Python memory service
  // has finished starting, so a refused connection must buffer, not drop.
  it('buffers while the memory service is unreachable and replays once it is up', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const networkFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('{"recorded":1}', { status: 200 }));
    const log = new ActivityLog(
      networkFetch,
      () => 42,
      () => 'event-1'
    );

    log.record({ channel: 'runtime', status: 'error', message: 'boom' });
    await log.flush();

    expect(log.bufferedCount).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('记忆服务不可用');

    await vi.advanceTimersByTimeAsync(2_000);
    await log.flush();

    expect(log.bufferedCount).toBe(0);
    expect(networkFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(networkFetch.mock.calls[1][1]?.body))).toMatchObject({
      event: { id: 'event-1', message: 'boom' }
    });

    warn.mockRestore();
    vi.useRealTimers();
  });
});
