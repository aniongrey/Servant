import { RuntimeStore } from '../../app/state/RuntimeStore';
import { createGlobalNetworkFetch } from '../../app/network/globalNetworkFetch';
import { loadUiPreferences } from '../../app/settings/uiPreferences';
import { TtsManager } from '../../ai/tts/TtsManager';
import { SpeechController } from '../../ai/tts/SpeechController';
import speechCatalog from '../../ai/tts/assets/intents.json';
import { resolveConfiguredSpeech } from '../../ai/tts/resolveConfiguredSpeech';
import { createActiveTtsProvider } from '../../ai/tts/createActiveTtsProvider';
import { loadCharacterVoiceConfig } from '../../ai/tts/characterVoiceConfig';
import { loadSpeechSdkTtsConfig } from '../../ai/tts/speechSdkTtsConfig';

/**
 * 为一个**没有渲染模型**的角色创建「纯语音」引擎。
 *
 * 多人聊天的语音由 pet 窗口播放，而 pet 窗口只在投射（开舞台）时渲染所有角色；
 * 不开舞台时它只有主角色一个模型，非主角色的语音事件找不到对应的
 * `DesktopConversationSpeechStream`，于是被压进 pending 永远不播——「语音只有主角色有」。
 *
 * 语音合成其实不需要模型：它只认 TTS provider + 一句文本。所以这里直接拼一个最小的
 * `SpeechController`（空 store，不接任何口型 / 气泡 / 动作），喂给同一个
 * `DesktopConversationSpeechStream` 就能出声。`sayText` 会 patch store 的 speech 状态，
 * 但那个状态只有渲染的模型才读，没人读就只是白写，无副作用。
 */
export function createVoiceOnlySpeech(voiceId: string): SpeechController {
  const preferences = loadUiPreferences();
  const networkFetch = createGlobalNetworkFetch({
    proxyEnabled: preferences.proxyEnabled,
    proxyUrl: preferences.proxyUrl
  });
  // 角色音色不存在（导入后被清）时退回全局 TTS 配置，绝不能静默无声。
  let provider;
  try {
    provider = createActiveTtsProvider(loadCharacterVoiceConfig(voiceId), networkFetch);
  } catch {
    provider = createActiveTtsProvider(loadSpeechSdkTtsConfig(), networkFetch);
  }
  const store = new RuntimeStore();
  const tts = new TtsManager(provider, store);
  return new SpeechController(speechCatalog, store, 520, tts, resolveConfiguredSpeech);
}
