import { delay, throwIfAborted } from '../../app/utils/delay';
import type { DesktopReplySegment, VoiceStreamEvent } from '../../app/network/realtime/VoiceStreamProtocol';

export async function pushEmotionTest(
  send: (event: VoiceStreamEvent) => void,
  id: string,
  segments: DesktopReplySegment[],
  stream: boolean,
  intervalMs: number,
  signal: AbortSignal
) {
  if (!segments.length || segments.length > 32 || segments.some((segment) =>
    !segment.text.trim() || segment.text.length > 1000 || !segment.spokenText.trim() || segment.spokenText.length > 2000 || !segment.shortAction))
    throw new Error('请选择动作并填写有效台词，最多 32 段');
  throwIfAborted(signal);
  if (!stream) {
    send({ type: 'reply-sequence', id, segments, source: 'conversation' });
    return;
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 0 || intervalMs > 10000)
    throw new Error('分段间隔应为 0–10 秒');
  send({ type: 'reply-stream-start', id, segment: segments[0], source: 'conversation' });
  for (let index = 1; index < segments.length; index++) {
    await delay(intervalMs, signal);
    throwIfAborted(signal);
    send({ type: 'reply-stream-segment', id, index, segment: segments[index], source: 'conversation' });
  }
  throwIfAborted(signal);
  send({ type: 'reply-stream-end', id, segmentCount: segments.length, source: 'conversation' });
}
