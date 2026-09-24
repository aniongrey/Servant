import { describe, expect, it, vi } from 'vitest';
import { liveConfig } from '../config/live.config.ts';
import { LiveEventNormalizer } from '../events/LiveEventNormalizer';
import type { BarrageGrabSocket } from './BarrageGrabAdapter';
import { BarrageGrabAdapter } from './BarrageGrabAdapter';

describe('BarrageGrabAdapter', () => {
  it('connects, parses messages, and emits normalized events', () => {
    const sockets: FakeSocket[] = [];
    const adapter = new BarrageGrabAdapter(new LiveEventNormalizer(liveConfig), liveConfig, (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    });
    const events: string[] = [];
    adapter.onEvent((event) => events.push(event.content ?? ''));

    adapter.connect();
    sockets[0].open();
    sockets[0].message(
      JSON.stringify({
        platform: 'bilibili',
        type: 'DANMU_MSG',
        user: { id: '1', name: '小明' },
        content: '白白你好'
      })
    );

    expect(adapter.getStatus()).toBe('connected');
    expect(events).toEqual(['白白你好']);
  });

  it('reconnects with backoff after close', () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const config = {
      ...liveConfig,
      barrageGrab: {
        ...liveConfig.barrageGrab,
        reconnectDelayMs: 3000,
        maxReconnectDelayMs: 30000
      }
    };
    const adapter = new BarrageGrabAdapter(new LiveEventNormalizer(config), config, (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    });

    adapter.connect();
    sockets[0].close();
    expect(adapter.getStatus()).toBe('disconnected');
    vi.advanceTimersByTime(2999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
  });
});

class FakeSocket implements BarrageGrabSocket {
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(readonly url: string) {}

  open(): void {
    this.onopen?.(new Event('open'));
  }

  message(data: string): void {
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  close(): void {
    // Node's test environment has no `CloseEvent` global, and the adapter does
    // not read the event — it only needs to know that a close happened. Same
    // stand-in shape the sibling disconnect test uses.
    this.onclose?.({ type: 'close', code: 1000, reason: '', wasClean: true } as CloseEvent);
  }
}
