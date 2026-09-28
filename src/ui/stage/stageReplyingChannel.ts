/**
 * 「正在回复…」的跨窗口广播。
 *
 * 为什么状态要放在多人对话窗口而不是舞台自己算：舞台只读 `meeting.messages`，
 * 而消息一旦落库就等价于「已经说完了」——「还在往外铺字」这件事只有持有打字机
 * 时间线的那个窗口知道。所以由它算出截止时刻广播过来，舞台照单显示。
 *
 * 带上 `until`（绝对时间戳）而不是只发一个布尔：舞台可能晚开几秒（窗口创建、
 * 模型加载），拿到一个已经过期的 `until` 就能立刻判定「早该结束了」，
 * 不必等一条永远不会来的「结束」消息——那条消息会发给一个当时还不存在的窗口，
 * 然后永远丢失。
 */
export const STAGE_REPLYING_CHANNEL = 'servant.stage-replying.v1';

export interface StageReplyingEvent {
  sessionId: string;
  senderId: string;
  /** 展示截止的绝对时刻（`Date.now()` 口径）。 */
  until: number;
}

/** 广播「正在回复…」；传 `null` 表示立刻收掉。 */
export function publishStageReplying(
  event: { sessionId: string; senderId: string; until: number } | null
): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(STAGE_REPLYING_CHANNEL);
  channel.postMessage(event);
  channel.close();
}

/**
 * 订阅「正在回复…」。`until` 到点后**由订阅方自己**调 `handler(null)`，
 * 因为发布方可能就在那一刻关掉了窗口。
 */
export function listenStageReplying(handler: (event: StageReplyingEvent | null) => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const channel = new BroadcastChannel(STAGE_REPLYING_CHANNEL);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  channel.onmessage = ({ data }) => {
    clear();
    if (!data || typeof data !== 'object') {
      handler(null);
      return;
    }
    const event = data as Partial<StageReplyingEvent>;
    if (typeof event.sessionId !== 'string' || typeof event.senderId !== 'string' || typeof event.until !== 'number') {
      handler(null);
      return;
    }
    const remaining = event.until - Date.now();
    if (remaining <= 0) {
      handler(null);
      return;
    }
    handler({ sessionId: event.sessionId, senderId: event.senderId, until: event.until });
    timer = setTimeout(() => handler(null), remaining);
  };
  return () => {
    clear();
    channel.close();
  };
}
