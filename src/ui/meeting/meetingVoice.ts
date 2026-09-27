import type { AssistantIntent } from '../../ai/llm/types';
import type { VoiceStreamEvent } from '../../app/network/realtime/VoiceStreamProtocol';
import { listenVoiceBroadcast, publishVoiceBroadcast } from '../../ai/tts/voiceBroadcast';

const PLAYBACK_START_TIMEOUT_MS = 15_000;
const PLAYBACK_COMPLETE_TIMEOUT_MS = 120_000;

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
