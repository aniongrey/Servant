import type { SpeechSdkTtsLanguage } from './speechSdkTypes';
import { stripTtsEmotionMarkup, type TtsEmotionMarkup } from './ttsEmotionMarkup';

const API_URL = 'https://api.mymemory.translated.net/get';

export async function translateWithMyMemory(
  speech: string,
  language: SpeechSdkTtsLanguage,
  signal?: AbortSignal
): Promise<string> {
  return (await translateSpeechSegmentsWithMyMemory([speech], language, undefined, signal))[0] ?? '';
}

export async function translateSpeechSegmentsWithMyMemory(
  speeches: readonly string[],
  language: SpeechSdkTtsLanguage,
  emotionMarkup?: TtsEmotionMarkup,
  signal?: AbortSignal
): Promise<string[]> {
  if (speeches.length === 0) return [];
  if (language === 'zh' && !emotionMarkup) return [...speeches];

  return Promise.all(speeches.map(async (speech) => {
    const prefix = emotionMarkup ? speech.match(/^\s*(\[[^\]\r\n]{1,80}\]\s*)+/)?.[0] ?? '' : '';
    const query = stripTtsEmotionMarkup(speech, emotionMarkup);
    const url = new URL(API_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('langpair', `zh|${language}`);
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`MyMemory 翻译失败（${response.status}）。`);
    const data = (await response.json()) as { responseData?: { translatedText?: string } };
    const translated = data.responseData?.translatedText?.trim();
    if (!translated) throw new Error('MyMemory 没有返回翻译文本。');
    return `${prefix}${translated}`;
  }));
}
