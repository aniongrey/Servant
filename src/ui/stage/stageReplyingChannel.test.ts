import { afterEach, describe, expect, it, vi } from 'vitest';
import { listenStageReplying, publishStageReplying } from './stageReplyingChannel';

/**
 * 极简 `BroadcastChannel` 替身：所有通道共享一份订阅者列表，`postMessage` 直接
 * 派发。够用来验证两件真正容易出错的事——过期消息被丢弃、以及到点后自己收尾。
 */
class FakeBroadcastChannel {
  private static subscribers = new Set<(event: { data: unknown }) => void>();
  private handler: ((event: { data: unknown }) => void) | null = null;

  static reset() {
    FakeBroadcastChannel.subscribers.clear();
  }

  set onmessage(value: ((event: { data: unknown }) => void) | null) {
    if (this.handler) FakeBroadcastChannel.subscribers.delete(this.handler);
    this.handler = value;
    if (value) FakeBroadcastChannel.subscribers.add(value);
  }

  get onmessage() {
    return this.handler;
  }

  postMessage(data: unknown) {
    for (const subscriber of [...FakeBroadcastChannel.subscribers]) subscriber({ data });
  }

  close() {
    this.onmessage = null;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeBroadcastChannel.reset();
});

function useFakeChannel() {
  FakeBroadcastChannel.reset();
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
}

describe('stage replying channel', () => {
  it('drops a message whose deadline already passed', () => {
    useFakeChannel();
    const seen: unknown[] = [];
    const stop = listenStageReplying((event) => seen.push(event));
    // 舞台可能在窗口创建上慢几秒，这条「正在回复」到它手里已经过期——
    // 必须立刻当作「没人正在回复」，否则界面会挂住。
    publishStageReplying({ sessionId: 'a', senderId: 'b', phase: 'replying', until: Date.now() - 1000 });
    expect(seen).toEqual([null]);
    stop();
  });

  it('forwards a live deadline and then clears it on its own', () => {
    vi.useFakeTimers();
    try {
      useFakeChannel();
      const seen: unknown[] = [];
      const stop = listenStageReplying((event) => seen.push(event));
      publishStageReplying({ sessionId: 'a', senderId: 'b', phase: 'replying', until: Date.now() + 500 });
      expect(seen).toEqual([{ sessionId: 'a', senderId: 'b', phase: 'replying', until: expect.any(Number) }]);
      // 发布方可能就在这一刻关窗，所以到点必须由订阅方自己收尾。
      vi.advanceTimersByTime(600);
      expect(seen.at(-1)).toBeNull();
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a null broadcast as an immediate clear', () => {
    useFakeChannel();
    const seen: unknown[] = [];
    const stop = listenStageReplying((event) => seen.push(event));
    publishStageReplying(null);
    expect(seen).toEqual([null]);
    stop();
  });

  it('forwards thinking with the actual character and clears it explicitly', () => {
    useFakeChannel();
    const seen: unknown[] = [];
    const stop = listenStageReplying((event) => seen.push(event));
    publishStageReplying({ sessionId: 'a', senderId: 'b', phase: 'thinking' });
    expect(seen).toEqual([{ sessionId: 'a', senderId: 'b', phase: 'thinking' }]);
    publishStageReplying(null);
    expect(seen.at(-1)).toBeNull();
    stop();
  });
});
