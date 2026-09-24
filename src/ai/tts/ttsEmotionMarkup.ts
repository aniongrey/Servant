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
      '当前 TTS 是 Fish Audio S2 Pro。只在自然需要时，在朗读文本中加入 S2 方括号英文 cue。',
      '每句必须有且只有一个句首 cue。可使用 [happy]、[sad]、[disappointed]、[sobbing]、[laughing]、[whispering] 等英文标签。'
    ].join('\n');
  }
  if (markup === 'doubao-2') {
    return [
      '当前 TTS 是豆包 TTS 2.0。只在自然需要时，在朗读文本中加入方括号中文语音标签。',
      '每句必须有且只有一个句首标签。标签应是简短、具体的表情、心理、肢体或语气描述，例如 [开心地说]、[失望地垂下声音]、[忍不住啜泣]。'
    ].join('\n');
  }
  return '';
}
