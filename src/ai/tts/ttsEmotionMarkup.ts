import type { SpeechSdkTtsProviderConfig } from './speechSdkTypes';

export type TtsEmotionMarkup = 'fish-s2' | 'doubao-2';

export function resolveTtsEmotionMarkup(
  config: Pick<SpeechSdkTtsProviderConfig, 'provider' | 'model'>
): TtsEmotionMarkup | undefined {
  if (config.provider === 'fish' && /^s2(?:[.-]|$)/i.test(config.model.trim())) return 'fish-s2';
  if (config.provider === 'doubao' && /-2\.0$/i.test(config.model.trim())) return 'doubao-2';
  return undefined;
}

export function stripTtsEmotionMarkup(text: string, markup?: TtsEmotionMarkup): string {
  if (!markup) return text.trim();
  return text
    .replace(/\[[^\]\r\n]{1,80}\]\s*/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

export function buildTtsEmotionPrompt(markup?: TtsEmotionMarkup): string {
  if (markup === 'fish-s2') {
    return [
      '当前语音使用 Fish Audio S2。每个 replies 元素都要提供 ttsEmotion 字段，值只写英文标签正文，不含方括号。',
      '标签随语义选择，例如 happy、sad、disappointed、sobbing、laughing、whispering；最终朗读文本会自动加方括号，如 [happy]、[sobbing]。'
    ].join('\n');
  }
  if (markup === 'doubao-2') {
    return [
      '当前语音使用豆包 TTS 2.0。每个 replies 元素都要提供 ttsEmotion 字段，值只写中文语气标签正文，不含方括号。',
      '标签用简短、具体的表情、心理、肢体或语气描述，例如 开心地说、失望地垂下声音、忍不住啜泣；最终朗读文本会自动加方括号，如 [开心地说]。'
    ].join('\n');
  }
  return '';
}
