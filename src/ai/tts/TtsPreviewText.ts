import { type SpeechSdkTtsProviderConfig } from './speechSdkTypes';

export type TtsPreviewTranslator = (
  speech: string,
  language: SpeechSdkTtsProviderConfig['ttsLanguage'],
  signal?: AbortSignal
) => Promise<string>;

export async function resolveTtsPreviewText(
  text: string,
  config: Pick<SpeechSdkTtsProviderConfig, 'ttsTranslationEnabled' | 'ttsLanguage'>,
  translate: TtsPreviewTranslator,
  signal?: AbortSignal
): Promise<string> {
  const speech = text.trim() || 'Speech SDK test.';
  if (!config.ttsTranslationEnabled || config.ttsLanguage === 'zh') return speech;

  const translated = (await translate(speech, config.ttsLanguage, signal)).trim();
  if (!translated) throw new Error('语言转换没有返回可朗读文本。');
  return translated;
}
