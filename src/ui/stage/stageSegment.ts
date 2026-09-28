import type { PersonalityMood } from '../../ai/llm/types';
import type { VoiceStreamEvent } from '../../app/network/realtime/VoiceStreamProtocol';

/**
 * 舞台对白框当前展示的那一段。
 *
 * 一批播放事件本来就能回答「现在在说哪一段」——`reply-stream-start` 是第一段，
 * `reply-stream-segment` 是后续段，每段都自带 `emotion` / `shortAction`。所以对白框
 * 直接吃这个流，不必再去猜「`messages.at(-1)` 是不是当前这句」。
 *
 * 一轮里各段的 `text` 落库时是分开写进 `meeting.messages` 的（见 `runQueue`），
 * 但**播放是逐段的**，两者靠 `messageId` 对齐：`meeting-<uuid>` 里的 uuid 就是
 * 那条消息的 id。
 */
export interface StageSegment {
  /** `meeting-<messageId>`，用来把这段对回到具体的消息上。 */
  id: string;
  /** 去掉 `meeting-` 前缀的消息 id。 */
  messageId: string;
  characterId: string;
  text: string;
  emotion: PersonalityMood;
  intensity: number;
  shortAction: string;
}

/**
 * 把一条播放事件读成「该显示哪一段」，不相关的事件返回 null。
 *
 * 只有**段**级事件算数：`speech-start` / `speech-delta` 走的是另一条路（单句、
 * 没有 emotion），它们不该覆盖对白框里正在演的那句。
 */
export function segmentFromVoiceEvent(event: VoiceStreamEvent): StageSegment | null {
  if (event.type === 'reply-sequence') {
    // 整轮一次性发过来时，取第一段——后续段会各自再发 `reply-stream-segment`。
    const first = event.segments[0];
    if (!first) return null;
    return toSegment(event.id, event.characterId, first);
  }
  if (event.type === 'reply-stream-start') return toSegment(event.id, event.characterId, event.segment);
  if (event.type === 'reply-stream-segment') return toSegment(event.id, event.characterId, event.segment);
  return null;
}

function toSegment(
  id: string,
  characterId: string | undefined,
  segment: { text: string; emotion: PersonalityMood; intensity: number; shortAction: string }
): StageSegment {
  return {
    id,
    messageId: id.replace(/^meeting-/, ''),
    characterId: characterId ?? '',
    text: segment.text,
    emotion: segment.emotion,
    intensity: segment.intensity,
    shortAction: segment.shortAction
  };
}
