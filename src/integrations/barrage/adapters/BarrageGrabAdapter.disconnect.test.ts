import { describe, expect, it, vi } from 'vitest';
import { BarrageGrabAdapter, type BarrageGrabSocket } from './BarrageGrabAdapter';
import { liveConfig } from '../config/live.config.ts';

describe('BarrageGrabAdapter disconnect', () => {
  it('does not reconnect after an intentional disconnect', () => {
    vi.useFakeTimers();
    const sockets: BarrageGrabSocket[] = [];
    const adapter = new BarrageGrabAdapter(undefined, liveConfig, () => {
      const socket: BarrageGrabSocket = {
        onopen: null,
        onclose: null,
        onerror: null,
        onmessage: null,
        close() {
          this.onclose?.({} as CloseEvent);
        }
      };
      sockets.push(socket);
      return socket;
    });

    adapter.connect();
    adapter.disconnect();
    vi.advanceTimersByTime(liveConfig.barrageGrab.maxReconnectDelayMs);

    expect(sockets).toHaveLength(1);
    expect(adapter.getStatus()).toBe('disconnected');
    vi.useRealTimers();
  });
});
