import type { AssistantIntent } from './types';
import { parsePrioritizedAssistantOutput, validateAssistantIntent } from './AiSdkClient';
import { defaultReplyShortActionId } from '../../character/motion/reply/shortActionVocabulary';

const MAX_RETRIES = 1;

export class LlmOutputPreprocessor {
  async process<T>(request: () => Promise<string>, parse: (raw: string) => T): Promise<T> {
    let attempts = 0;
    while (true) {
      let normalized = '';
      try {
        normalized = normalizeLlmOutput(await request());
        return parse(normalized);
      } catch (error) {
        if (attempts++ >= MAX_RETRIES) {
          if (error instanceof Error) Object.assign(error, { rawOutput: normalized });
          throw error;
        }
      }
    }
  }

  processAssistant(raw: string): AssistantIntent {
    const normalized = normalizeLlmOutput(raw).trim();
    try {
      const parsed = parsePrioritizedAssistantOutput(normalized, true).intent;
      return validateAssistantIntentStrict(parsed);
    } catch (error) {
      if (!/[{}\[\]]/u.test(normalized)) {
        return {
          replies: [
            {
              speech: normalized,
              emotion: 'neutral',
              intensity: 0.5,
              shortAction: defaultReplyShortActionId,
              ttsEmotion: 'calm'
            }
          ],
          speech: normalized,
          emotion: 'neutral',
          intensity: 0.5,
          soulEvent: 'chat',
          memories: []
        };
      }
      throw error;
    }
  }
}

export function normalizeLlmOutput(raw: string): string {
  return raw
    .replace(/,\s*(\{"replies"\s*:\s*\[\s*\{)/g, '$1')
    .replace(/\\_/g, '_');
}

function validateAssistantIntentStrict(raw: Partial<AssistantIntent> | undefined): AssistantIntent {
  if (!raw) throw new Error('LLM 返回的 JSON 无效。');
  const intent = validateAssistantIntent(raw);
  if (!intent.replies.length) throw new Error('LLM 返回的回复内容无效。');
  return intent;
}
