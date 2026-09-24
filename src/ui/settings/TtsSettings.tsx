import { type UiPreferences } from '../../app/settings/uiPreferences';
import { TTS_PREVIEW_ON_APPLY_STORAGE_KEY } from '../../app/settings/storageKeys';

import { useEffect, useState, useMemo } from 'react';
import {
  loadSpeechSdkTtsConfig,
  isSpeechSdkTtsConfigComplete,
  normalizeSpeechSdkTtsProviderConfig,
  getSpeechSdkConfigForProvider,
  createDefaultSpeechSdkConfigForProvider,
  saveSpeechSdkTtsConfig
} from '../../ai/tts/speechSdkTtsConfig';
import {
  getSpeechSdkProviderOption,
  getTtsProviderKind,
  getSpeechSdkCustomVoiceValue,
  disabledSpeechSdkProviderOption,
  recommendedSpeechSdkProviderOptions,
  otherSpeechSdkProviderOptions,
  getDoubaoVoiceConsoleEntry,
  isPresetSpeechSdkModel,
  speechSdkModelSupportsInstructions
} from '../../ai/tts/speechSdkProviderOptions';
import { type SpeechSdkTtsProviderConfig, type SpeechSdkProviderId } from '../../ai/tts/speechSdkTypes';
import { createActiveTtsProvider } from '../../ai/tts/createActiveTtsProvider';
import { GPT_SOVITS_STUDIO_PAGE } from '../../app/network/gptSovitsContract';
import { createGlobalNetworkFetch } from '../../app/network/globalNetworkFetch';
import { resolveTtsPreviewText } from '../../ai/tts/TtsPreviewText';
import { translateWithMyMemory } from '../../ai/tts/MyMemoryTranslator';
import { PanelTitle, ControlRange, Toggle } from './SettingsControls';
import { useGptSovitsRoles } from './useGptSovitsRoles';
import { Volume2, Save, RefreshCw } from 'lucide-react';

export function TtsSettings({ preferences }: { preferences: UiPreferences }) {
  const [draft, setDraft] = useState(loadSpeechSdkTtsConfig);
  const [testText, setTestText] = useState('就是你要成为我的Master?');
  const [status, setStatus] = useState('配置由主页和 /debug 调试页共用。');
  const [previewOnApply, setPreviewOnApply] = useState(
    // 初始参数：应用配置后默认试听一次，只有显式关掉才跳过。
    () => localStorage.getItem(TTS_PREVIEW_ON_APPLY_STORAGE_KEY) !== 'false'
  );
  const [testing, setTesting] = useState(false);
  const provider = getSpeechSdkProviderOption(draft.provider);
  const providerKind = getTtsProviderKind(draft.provider);
  const configIsComplete = isSpeechSdkTtsConfigComplete(draft);
  const gptSovits = useGptSovitsRoles(providerKind === 'gpt-sovits');
  const voiceIsPreset = provider.voices.some((option) => option.id === draft.voice);
  const modelSuggestionListId = `tts-model-suggestions-${draft.provider}`;
  const customVoiceValue = getSpeechSdkCustomVoiceValue(draft.provider, draft.voice);
  const networkFetch = useMemo(
    () =>
      createGlobalNetworkFetch({ proxyEnabled: preferences.proxyEnabled, proxyUrl: preferences.proxyUrl }),
    [preferences.proxyEnabled, preferences.proxyUrl]
  );
  const updateConfig = (patch: Partial<SpeechSdkTtsProviderConfig>) => {
    setDraft((current) => normalizeSpeechSdkTtsProviderConfig({ ...current, ...patch }));
    setStatus('配置已修改，点击“应用配置”后同步到 Debug 播放。');
  };
  // A local GPT-SoVITS only needs one decision — which role preset to speak
  // with — so pick the first one instead of leaving the provider unusable.
  useEffect(() => {
    if (providerKind !== 'gpt-sovits') return;
    if (draft.voice.trim() || gptSovits.profiles.length === 0) return;
    setDraft((current) =>
      normalizeSpeechSdkTtsProviderConfig({ ...current, voice: gptSovits.profiles[0].id })
    );
  }, [providerKind, draft.voice, gptSovits.profiles]);

  const selectProvider = (providerId: SpeechSdkProviderId) => {
    const next = getSpeechSdkConfigForProvider(
      providerId,
      draft.provider === providerId ? draft : createDefaultSpeechSdkConfigForProvider(providerId)
    );
    setDraft(next);
    setStatus(`已切换到 ${getSpeechSdkProviderOption(providerId).label}，点击“应用配置”后生效。`);
  };
  const runVoicePreview = async (next: SpeechSdkTtsProviderConfig) => {
    const nextProviderKind = getTtsProviderKind(next.provider);
    if (nextProviderKind === 'disabled') throw new Error('TTS 已关闭，请先选择语音提供商。');
    if (!isSpeechSdkTtsConfigComplete(next)) {
      throw new Error(
        nextProviderKind === 'gpt-sovits'
          ? '请先选择一个 GPT-SoVITS 角色。'
          : '请先填写 API Key、模型和音色。'
      );
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const tts = createActiveTtsProvider(next, networkFetch);
      const previewText = await resolveTtsPreviewText(
        testText,
        next,
        (speech, language, signal) => translateWithMyMemory(speech, language, signal),
        controller.signal
      );
      await tts.speak(previewText, { signal: controller.signal });
      return next.ttsTranslationEnabled && next.ttsLanguage !== 'zh' ? '语言转换试听完成。' : '试听完成。';
    } finally {
      window.clearTimeout(timeout);
    }
  };
  const describePreviewFailure = (cause: unknown) => {
    if (cause instanceof Error && cause.name === 'AbortError') return '试听超时。';
    return cause instanceof Error ? cause.message : '未知错误';
  };
  const testVoice = async () => {
    setTesting(true);
    setStatus(
      draft.ttsTranslationEnabled && draft.ttsLanguage !== 'zh'
        ? '正在转换并播放语音…'
        : '正在请求并播放语音…'
    );
    try {
      setStatus(await runVoicePreview(draft));
    } catch (cause) {
      setStatus(`试听失败：${describePreviewFailure(cause)}`);
    } finally {
      setTesting(false);
    }
  };
  const applyConfig = async () => {
    const next = normalizeSpeechSdkTtsProviderConfig(draft);
    saveSpeechSdkTtsConfig(next);
    setDraft(next);
    if (!previewOnApply) {
      setStatus('TTS 配置已保存，Debug 播放已切换到新配置。');
      return;
    }
    setTesting(true);
    setStatus('TTS 配置已保存，正在试听…');
    try {
      setStatus(await runVoicePreview(next));
    } catch (cause) {
      setStatus(`已保存配置，但试听失败：${describePreviewFailure(cause)}`);
    } finally {
      setTesting(false);
    }
  };
  const togglePreviewOnApply = (enabled: boolean) => {
    setPreviewOnApply(enabled);
    localStorage.setItem(TTS_PREVIEW_ON_APPLY_STORAGE_KEY, String(enabled));
  };
  const gptSovitsRoleMissing =
    providerKind === 'gpt-sovits' &&
    Boolean(draft.voice.trim()) &&
    gptSovits.profiles.length > 0 &&
    !gptSovits.profiles.some((profile) => profile.id === draft.voice);
  const gptSovitsStatus = gptSovits.error
    ? `读取 GPT-SoVITS 配置失败：${gptSovits.error}`
    : gptSovits.health
    ? gptSovits.health.connected
      ? 'GPT-SoVITS 9880 已连接。'
      : `${gptSovits.health.description}（角色配置与试听仍可保存，实际合成需要 9880 在线）`
    : '正在检测 GPT-SoVITS 9880…';
  return (
    <div className="aurelia-content-grid">
      <section className="aurelia-panel">
        <PanelTitle title="模型与音色" eyebrow="VOICE" />
        <label className="aurelia-field">
          <span>语音提供商</span>
          <select
            value={draft.provider}
            onChange={(event) => selectProvider(event.currentTarget.value as SpeechSdkProviderId)}
          >
            <option value={disabledSpeechSdkProviderOption.id}>
              {disabledSpeechSdkProviderOption.label}
            </option>
            <optgroup label="推荐">
              {recommendedSpeechSdkProviderOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="其他">
              {otherSpeechSdkProviderOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        {providerKind === 'disabled' ? (
          <div className="aurelia-empty-row">
            <Volume2 size={18} />
            <span>语音已关闭</span>
            <small>选择其他 Provider 后自动启用</small>
          </div>
        ) : null}
        {providerKind === 'local' ? (
          <div className="aurelia-empty-row">
            <Volume2 size={18} />
            <span>本地 Microsoft 系统语音</span>
            <small>使用 Windows / Edge 已安装音色，不需要 API Key</small>
          </div>
        ) : null}
        {providerKind === 'gpt-sovits' ? (
          <>
            <label className="aurelia-field">
              <span>
                角色（音色）
                <button
                  className="aurelia-inline-action"
                  disabled={gptSovits.loading}
                  onClick={() => gptSovits.reload()}
                  type="button"
                >
                  <RefreshCw size={13} /> {gptSovits.loading ? '读取中' : '刷新'}
                </button>
              </span>
              <select
                disabled={gptSovits.profiles.length === 0}
                value={draft.voice}
                onChange={(event) => updateConfig({ voice: event.currentTarget.value })}
              >
                {gptSovits.profiles.length === 0 ? (
                  <option value="">{gptSovits.loading ? '正在读取角色…' : '暂无角色'}</option>
                ) : null}
                {gptSovitsRoleMissing ? (
                  <option value={draft.voice}>{`${draft.voice}（角色已删除）`}</option>
                ) : null}
                {gptSovits.profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>
            <a className="aurelia-field-hint" href={GPT_SOVITS_STUDIO_PAGE}>
              前往 GPT-SoVITS 配置页维护角色、权重与参考音频 →
            </a>
            <p className="aurelia-field-hint">{gptSovitsStatus}</p>
          </>
        ) : null}
        {providerKind === 'speech-sdk' ? (
          <>
            <label className="aurelia-field">
              <span>模型</span>
              {/* Free text with preset autocomplete: an empty field offers every
                  preset, typing filters them, and any other id can be entered
                  directly — `normalizeSpeechSdkTtsProviderConfig` keeps it. */}
              <input
                autoComplete="off"
                list={modelSuggestionListId}
                value={draft.model}
                onChange={(event) => updateConfig({ model: event.currentTarget.value })}
                placeholder={provider.models[0]?.id ?? '模型 ID'}
              />
            </label>
            <datalist id={modelSuggestionListId}>
              {provider.models.map((option) => (
                <option key={option.id} label={option.label} value={option.id} />
              ))}
            </datalist>
            {draft.model.trim() && !isPresetSpeechSdkModel(draft.provider, draft.model) ? (
              <p className="aurelia-field-hint">自定义模型 ID（不在预设列表中）。</p>
            ) : null}
            {draft.provider === 'doubao' ? (
              <a
                className="aurelia-field-hint"
                href={getDoubaoVoiceConsoleEntry(draft.model).href}
                rel="noreferrer"
                target="_blank"
              >
                {getDoubaoVoiceConsoleEntry(draft.model).label}
              </a>
            ) : provider.voices.length > 0 ? (
              <label className="aurelia-field">
                <span>公共音色</span>
                <select
                  value={voiceIsPreset ? draft.voice : provider.defaultVoice}
                  onChange={(event) => updateConfig({ voice: event.target.value })}
                >
                  {provider.voices.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {provider.customVoice ? (
              <label className="aurelia-field">
                <span>{provider.voices.length > 0 ? '私有 Voice ID（可选，优先）' : 'Voice ID'}</span>
                <input
                  autoComplete="off"
                  value={customVoiceValue}
                  onChange={(event) => updateConfig({ voice: event.currentTarget.value })}
                  placeholder={provider.voiceHint ?? '账号中的 Voice ID'}
                />
              </label>
            ) : null}
            <label className="aurelia-field">
              <span>
                API Key
                {provider.apiKeyUrl ? (
                  <a href={provider.apiKeyUrl} rel="noreferrer" target="_blank">
                    获取 {provider.label} API Key ↗
                  </a>
                ) : null}
              </span>
              <input
                autoComplete="off"
                type="password"
                value={draft.apiKey ?? ''}
                onChange={(event) => updateConfig({ apiKey: event.currentTarget.value })}
                placeholder="仅保存在当前浏览器"
              />
            </label>
          </>
        ) : null}
        {/* GPT-SoVITS takes its speed from the role preset, so none of these
            knobs apply — the settings stay at "pick a role". */}
        {providerKind === 'local' || providerKind === 'speech-sdk' ? (
          <details className="aurelia-tts-playback-details">
            <summary>
              <span>播放参数</span>
              <small>语速、输出格式与朗读指令</small>
            </summary>
            <div className="aurelia-tts-playback-fields">
              <ControlRange
                label="语速"
                min={0.75}
                max={1.5}
                step={0.05}
                value={draft.speed}
                onChange={(speed) => updateConfig({ speed })}
              />
              {draft.provider === 'doubao' ? (
                <>
                  <label className="aurelia-field">
                    <span>响度</span>
                    <input
                      type="number"
                      min={-10}
                      max={10}
                      step={0.1}
                      value={draft.loudnessRate}
                      onChange={(event) => updateConfig({ loudnessRate: Number(event.currentTarget.value) })}
                    />
                  </label>
                  <label className="aurelia-field">
                    <span>音调</span>
                    <input
                      type="number"
                      min={-10}
                      max={10}
                      step={0.1}
                      value={draft.pitchRate}
                      onChange={(event) => updateConfig({ pitchRate: Number(event.currentTarget.value) })}
                    />
                  </label>
                </>
              ) : null}
              {providerKind === 'speech-sdk' ? (
                <label className="aurelia-field">
                  <span>输出格式</span>
                  <select
                    value={draft.outputFormat}
                    onChange={(event) =>
                      updateConfig({
                        outputFormat: event.currentTarget.value as SpeechSdkTtsProviderConfig['outputFormat']
                      })
                    }
                  >
                    <option value="mp3">MP3</option>
                    <option value="wav">WAV</option>
                    {draft.provider !== 'doubao' ? <option value="pcm">PCM</option> : null}
                  </select>
                </label>
              ) : null}
              {speechSdkModelSupportsInstructions(draft) ? (
                <label className="aurelia-field">
                  <span>朗读指令</span>
                  <textarea
                    rows={2}
                    value={draft.instructions}
                    onChange={(event) => updateConfig({ instructions: event.currentTarget.value })}
                    placeholder="温柔、自然、稍微带一点陪伴感"
                  />
                </label>
              ) : null}
            </div>
          </details>
        ) : null}
        <div className="aurelia-voice-test aurelia-voice-test-inline">
          <input
            aria-label="试听文本"
            value={testText}
            onChange={(event) => setTestText(event.currentTarget.value)}
          />
          <button disabled={testing || !configIsComplete} onClick={() => void testVoice()} type="button">
            <Volume2 size={14} /> 手动试听
          </button>
          <label className="aurelia-action-toggle">
            <span>自动试听</span>
            <Toggle checked={previewOnApply} label="应用配置时试听" onChange={togglePreviewOnApply} />
          </label>
          <button disabled={testing} onClick={() => void applyConfig()} type="button">
            <Save size={14} /> {testing ? '试听中' : '应用配置'}
          </button>
          <small>{status}</small>
        </div>
      </section>
      <section className="aurelia-panel aurelia-translation-panel">
        <PanelTitle title="语言转换" eyebrow="LLM → TTS" />
        <div className="aurelia-translation-layout aurelia-translation-layout-compact">
          <div className="aurelia-translation-switch">
            <span>启用语言转换（翻译MyMemory 每日5000字）</span>
            <Toggle
              checked={draft.ttsTranslationEnabled}
              label="启用语言转换"
              onChange={(ttsTranslationEnabled) => updateConfig({ ttsTranslationEnabled })}
            />
          </div>
          <label className="aurelia-field aurelia-translation-language">
            <span>目标语言</span>
            <select
              disabled={!draft.ttsTranslationEnabled}
              value={draft.ttsLanguage}
              onChange={(event) =>
                updateConfig({
                  ttsLanguage: event.currentTarget.value as SpeechSdkTtsProviderConfig['ttsLanguage']
                })
              }
            >
              <option value="zh">汉语</option>
              <option value="ja">日语</option>
              <option value="en">英语</option>
              <option value="ko">韩语</option>
            </select>
          </label>
        </div>
        <p className="aurelia-field-hint">选完记得点应用配置！！！</p>
      </section>
    </div>
  );
}
