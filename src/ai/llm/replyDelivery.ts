export function getReplyDelayMs(text: string, index: number): number {
  if (index === 0) return 0;
  const characters = [...text.replace(/\s/g, '')].length;
  return Number((characters / 10).toFixed(1)) * 1_000;
}

/** Gap between queue drains once `turn-end` proved the reply has no more segments. */
export const COMPLETED_TURN_DRAIN_GAP_MS = 150;

/**
 * Display delay for the head of the pending-segment queue.
 *
 * While the server is still streaming the reply keeps its typing rhythm
 * (`getReplyDelayMs`). After `turn-end` no further segment can arrive, so
 * mimicking typing would only leave already-received segments waiting — and the
 * "对方正在输入…" indicator lit — for content the client already holds. The
 * remaining queue drains as a short burst instead.
 */
export function getQueuedSegmentDelayMs(text: string, index: number, turnComplete: boolean): number {
  return turnComplete ? COMPLETED_TURN_DRAIN_GAP_MS : getReplyDelayMs(text, index);
}
