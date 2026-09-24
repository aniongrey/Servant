import type { AssistantReplySegment } from '../llm/types';
import type { AiSdkClient } from '../llm/AiSdkClient';
import type { SpeechSdkTtsLanguage } from './speechSdkTypes';
import type { TtsEmotionMarkup } from './ttsEmotionMarkup';

export async function getSpokenReplySegments(
  translator: Pick<AiSdkClient, 'translateSpeechSegments'>,
  replies: readonly AssistantReplySegment[],
  ttsLanguage: SpeechSdkTtsLanguage,
  ttsEmotionMarkup?: TtsEmotionMarkup,
  signal?: AbortSignal
): Promise<Array<AssistantReplySegment & { spokenText: string }>> {
  signal?.throwIfAborted();
  if (ttsLanguage === 'zh' && !ttsEmotionMarkup) {
    return replies.map((reply) => ({ ...reply, spokenText: reply.speech }));
  }

  if (ttsEmotionMarkup && ttsLanguage === 'zh') {
    return replies.map((reply) => ({
      ...reply,
      spokenText: reply.ttsEmotion ? `[${reply.ttsEmotion}] ${reply.speech}` : reply.speech
    }));
  }

  let translated: string[];
  try {
    translated = await translator.translateSpeechSegments(
      replies.map((reply) => reply.speech),
      ttsLanguage,
      ttsEmotionMarkup,
      signal
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`TTS 语言转换失败：${reason}`, { cause: error });
  }
  signal?.throwIfAborted();
  return replies.map((reply, index) => {
    // A translation that comes back short, or with a blank line, is a partial
    // success rather than a failure: reading the original text is better than
    // dropping the whole reply. Throwing here used to turn one empty segment
    // into a turn that never got spoken at all.
    const spokenText = translated[index]?.trim() || reply.speech;
    return {
      ...reply,
      spokenText: reply.ttsEmotion ? `[${reply.ttsEmotion}] ${spokenText}` : spokenText
    };
  });
}
