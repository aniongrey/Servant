import type { AssistantIntent, PersonalityMood } from '../../ai/llm/types';
import type { VoiceStreamEvent } from '../../app/network/realtime/VoiceStreamProtocol';
import { listenVoiceBroadcast, publishVoiceBroadcast } from '../../ai/tts/voiceBroadcast';

const PLAYBACK_START_TIMEOUT_MS = 15_000;
const PLAYBACK_COMPLETE_TIMEOUT_MS = 120_000;

/**
 * 中文朗读大致的语速（字/秒）。用于**估计**一段台词的语音时长，喂给舞台打字机
 * 反推每字速度——不需要准，只要让「文字铺完」和「声音念完」落在同一个数量级。
 * 取 4.2 是常见中文 TTS 的中位值：再快会让打字机跟不上，再慢会显得拖。
 */
const ESTIMATED_CHARS_PER_SECOND = 4.2;

/** 一段台词的预计语音时长（毫秒），含少量起播停顿。 */
export function estimateSegmentDurationMs(text: string): number {
  const characters = Array.from(text.trim()).length;
  if (!characters) return 0;
  return Math.round((characters / ESTIMATED_CHARS_PER_SECOND) * 1000) + 400;
}

/**
 * 一段回复在界面上的表演参数。
 *
 * 与 {@link meetingReplyEvents} 分开导出：事件流是给角色模型的口型/动作通道，
 * 这里这组是给**对话框**的（名称旁的表情与动作标签、打字机速度），两者消费方
 * 完全不同，但都从同一份 `intent.replies` 里切出来，所以放在一起对读。
 */
export interface MeetingReplyPerformance {
  text: string;
  emotion: PersonalityMood;
  intensity: number;
  shortAction: string;
  estimatedDurationMs: number;
}

export function meetingReplyPerformances(intent: AssistantIntent): MeetingReplyPerformance[] {
  return intent.replies
    .map((reply) => ({
      text: reply.speech,
      emotion: reply.emotion,
      intensity: reply.intensity,
      shortAction: reply.shortAction,
      estimatedDurationMs: estimateSegmentDurationMs(reply.speech)
    }))
    .filter((performance) => performance.text.trim().length > 0);
}

export function meetingReplyEvents(
  id: string,
  characterId: string,
  intent: AssistantIntent
): VoiceStreamEvent[] {
  const segments = intent.replies.map((reply) => ({
    text: reply.speech,
    spokenText: reply.speech,
    emotion: reply.emotion,
    intensity: reply.intensity,
    shortAction: reply.shortAction
  }));
  if (!segments.length) return [];
  return [
    { type: 'reply-stream-start', id, characterId, segment: segments[0], source: 'conversation' },
    ...segments.slice(1).map((segment, index) => ({
      type: 'reply-stream-segment' as const,
      id,
      characterId,
      index: index + 1,
      segment,
      source: 'conversation' as const
    })),
    {
      type: 'reply-stream-end',
      id,
      characterId,
      segmentCount: segments.length,
      source: 'conversation'
    }
  ];
}

export async function playMeetingReply(
  id: string,
  characterId: string,
  intent: AssistantIntent,
  signal: AbortSignal
): Promise<void> {
  const events = meetingReplyEvents(id, characterId, intent);
  if (!events.length) return;
  const playback = waitForPlayback(id, characterId, signal);
  events.forEach((event) => publishVoiceBroadcast(event));
  try {
    if (!(await playback)) {
      publishVoiceBroadcast({ type: 'speech-cancel', id, characterId, source: 'conversation' });
    }
  } catch (cause) {
    if (signal.aborted) {
      publishVoiceBroadcast({ type: 'speech-cancel', id, characterId, source: 'conversation' });
    }
    throw cause;
  }
}

function waitForPlayback(id: string, characterId: string, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let timer = setTimeout(() => finish(false), PLAYBACK_START_TIMEOUT_MS);
    const unsubscribe = listenVoiceBroadcast((event) => {
      if (event.id !== id || event.characterId !== characterId) return;
      if (event.type === 'speech-playback-started') {
        clearTimeout(timer);
        timer = setTimeout(() => finish(false), PLAYBACK_COMPLETE_TIMEOUT_MS);
      } else if (event.type === 'speech-playback-completed') {
        finish(true);
      }
    });
    const abort = () => finish(false, signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });

    function finish(completed: boolean, cause?: unknown) {
      clearTimeout(timer);
      unsubscribe();
      signal.removeEventListener('abort', abort);
      if (cause) reject(cause);
      else resolve(completed);
    }
  });
}
