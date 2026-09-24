import {
  type SpeechSdkTtsProviderConfig,
  type SpeechSdkProviderId,
  type SpeechSdkTtsLanguage
} from '../../ai/tts/speechSdkTypes';
import {
  isSpeechSdkTtsConfigComplete,
  defaultSpeechSdkTtsProviderConfig
} from '../../ai/tts/speechSdkTtsConfig';
import {
  disabledSpeechSdkProviderOption,
  recommendedSpeechSdkProviderOptions,
  otherSpeechSdkProviderOptions,
  getDoubaoVoiceConsoleEntry,
  speechSdkModelSupportsInstructions
} from '../../ai/tts/speechSdkProviderOptions';
import { speechSdkTtsLanguageOptions } from './debugConfig';
import { useGptSovitsRoles } from '../settings/useGptSovitsRoles';
import { GPT_SOVITS_STUDIO_PAGE } from '../../app/network/gptSovitsContract';
import { RotateCcw, Play } from 'lucide-react';
import type { DebugSpeechSettings } from './useDebugSpeechSettings';

export function DebugSpeechPanel({
  speechSettings
}: {
  speechSettings: Pick<
    DebugSpeechSettings,
    | 'speechSdkConfig'
    | 'speechSdkProvider'
    | 'speechSdkProviderKind'
    | 'speechSdkVoiceIsPreset'
    | 'speechSdkCustomVoiceValue'
    | 'globalProxyEnabled'
    | 'setGlobalProxyEnabled'
    | 'globalProxyUrl'
    | 'setGlobalProxyUrl'
    | 'speechSdkSettingsError'
    | 'speechSdkTestText'
    | 'setSpeechSdkTestText'
    | 'updateSpeechSdkConfig'
    | 'selectSpeechSdkProvider'
    | 'resetSpeechSdkConfig'
    | 'testSpeechSdkVoice'
  >;
}) {
  const {
    speechSdkConfig,
    speechSdkProvider,
    speechSdkProviderKind,
    speechSdkVoiceIsPreset,
    speechSdkCustomVoiceValue,
    globalProxyEnabled,
    setGlobalProxyEnabled,
    globalProxyUrl,
    setGlobalProxyUrl,
    speechSdkSettingsError,
    speechSdkTestText,
    setSpeechSdkTestText,
    updateSpeechSdkConfig,
    selectSpeechSdkProvider,
    resetSpeechSdkConfig,
    testSpeechSdkVoice
  } = speechSettings;
  const gptSovitsRoles = useGptSovitsRoles(speechSdkProviderKind === 'gpt-sovits');

  return (
    <section className="settingsPage" aria-label="Settings">
      <div className="settingsHeader">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>系统设置</h2>
        </div>
      </div>
      <div className="settingsGroup">
        <div className="settingsGroupHeader">
          <div>
            <p className="eyebrow">Global Network</p>
            <h3>全局网络</h3>
          </div>
        </div>
        <div className="settingsGrid">
          <label className="settingsToggleRow settingsWideField">
            <span>使用系统 HTTP 代理</span>
            <input
              checked={globalProxyEnabled}
              onChange={(event) => setGlobalProxyEnabled(event.currentTarget.checked)}
              type="checkbox"
            />
          </label>
          <label className="settingsWideField">
            <span>HTTP 代理地址</span>
            <input
              value={globalProxyUrl}
              onChange={(event) => setGlobalProxyUrl(event.currentTarget.value)}
              placeholder="系统设置代理（默认 127.0.0.1:7890）"
            />
          </label>
        </div>
      </div>
      <div className="settingsGroup">
        <div className="settingsGroupHeader">
          <div>
            <p className="eyebrow">Voice</p>
            <h3>TTS</h3>
          </div>
          <button
            className="iconButton"
            onClick={resetSpeechSdkConfig}
            title="Reset TTS settings"
            type="button"
          >
            <RotateCcw size={16} />
          </button>
        </div>
        <div className="settingsGrid">
          <label>
            <span>Provider</span>
            <select
              value={speechSdkConfig.provider}
              onChange={(event) => selectSpeechSdkProvider(event.currentTarget.value as SpeechSdkProviderId)}
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
          {speechSdkProviderKind === 'local' ? (
            <p className="settingsStatus settingsWideField">
              使用 Windows / Edge 内置的 Microsoft 系统语音，不需要 API Key。
            </p>
          ) : null}
          {speechSdkProviderKind === 'disabled' ? (
            <p className="settingsStatus settingsWideField">当前不会生成或播放任何语音。</p>
          ) : null}
          {speechSdkProviderKind === 'gpt-sovits' ? (
            <>
              <label>
                <span>角色（音色）</span>
                <select
                  value={speechSdkConfig.voice}
                  onChange={(event) => updateSpeechSdkConfig({ voice: event.currentTarget.value })}
                >
                  {gptSovitsRoles.profiles.length === 0 ? (
                    <option value="">{gptSovitsRoles.loading ? '正在读取角色…' : '暂无角色'}</option>
                  ) : null}
                  {gptSovitsRoles.profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="settingsStatus settingsWideField">
                <a href={GPT_SOVITS_STUDIO_PAGE}>前往 GPT-SoVITS 配置页维护角色 →</a>
                {gptSovitsRoles.error
                  ? `（读取失败：${gptSovitsRoles.error}）`
                  : gptSovitsRoles.health?.connected
                  ? ' 9880 已连接。'
                  : ` ${gptSovitsRoles.health?.description ?? '正在检测 9880…'}`}
              </p>
            </>
          ) : null}
          {speechSdkProviderKind === 'speech-sdk' ? (
            <>
              <label>
                <span>模型</span>
                <select
                  value={speechSdkConfig.model}
                  onChange={(event) => updateSpeechSdkConfig({ model: event.currentTarget.value })}
                >
                  {speechSdkProvider.models.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {speechSdkConfig.provider === 'doubao' ? (
                <a
                  href={getDoubaoVoiceConsoleEntry(speechSdkConfig.model).href}
                  rel="noreferrer"
                  target="_blank"
                >
                  {getDoubaoVoiceConsoleEntry(speechSdkConfig.model).label}
                </a>
              ) : speechSdkProvider.voices.length > 0 ? (
                <label>
                  <span>公共音色</span>
                  <select
                    value={speechSdkVoiceIsPreset ? speechSdkConfig.voice : speechSdkProvider.defaultVoice}
                    onChange={(event) => updateSpeechSdkConfig({ voice: event.currentTarget.value })}
                  >
                    {speechSdkProvider.voices.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {speechSdkProvider.customVoice ? (
                <label>
                  <span>
                    {speechSdkProvider.voices.length > 0 ? '私有 Voice ID（可选，优先）' : 'Voice ID'}
                  </span>
                  <input
                    autoComplete="off"
                    value={speechSdkCustomVoiceValue}
                    onChange={(event) => updateSpeechSdkConfig({ voice: event.currentTarget.value })}
                    placeholder={speechSdkProvider.voiceHint ?? '账号中的 Voice ID'}
                  />
                </label>
              ) : null}
              <label>
                <span>API Key</span>
                {speechSdkProvider.apiKeyUrl ? (
                  <a href={speechSdkProvider.apiKeyUrl} rel="noreferrer" target="_blank">
                    获取 {speechSdkProvider.label} API Key ↗
                  </a>
                ) : null}
                <input
                  autoComplete="off"
                  value={speechSdkConfig.apiKey ?? ''}
                  onChange={(event) => updateSpeechSdkConfig({ apiKey: event.currentTarget.value })}
                  placeholder="Stored locally"
                  type="password"
                />
              </label>
              <label>
                <span>Output Format</span>
                <select
                  value={speechSdkConfig.outputFormat}
                  onChange={(event) =>
                    updateSpeechSdkConfig({
                      outputFormat: event.currentTarget.value as SpeechSdkTtsProviderConfig['outputFormat']
                    })
                  }
                >
                  <option value="mp3">MP3</option>
                  <option value="wav">WAV</option>
                  {speechSdkConfig.provider !== 'doubao' ? <option value="pcm">PCM</option> : null}
                </select>
              </label>
            </>
          ) : null}
          {speechSdkProviderKind !== 'disabled' ? (
            <>
              <label className="settingsToggleRow">
                <span>启用语言转换</span>
                <input
                  checked={speechSdkConfig.ttsTranslationEnabled === true}
                  onChange={(event) =>
                    updateSpeechSdkConfig({ ttsTranslationEnabled: event.currentTarget.checked })
                  }
                  type="checkbox"
                />
              </label>
              <label>
                <span>转换语言</span>
                <select
                  disabled={speechSdkConfig.ttsTranslationEnabled !== true}
                  value={speechSdkConfig.ttsLanguage ?? defaultSpeechSdkTtsProviderConfig.ttsLanguage}
                  onChange={(event) =>
                    updateSpeechSdkConfig({ ttsLanguage: event.currentTarget.value as SpeechSdkTtsLanguage })
                  }
                >
                  {speechSdkTtsLanguageOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Speed · {speechSdkConfig.speed.toFixed(2)}×</span>
                <input
                  max={1.5}
                  min={0.75}
                  onChange={(event) => updateSpeechSdkConfig({ speed: Number(event.currentTarget.value) })}
                  step={0.05}
                  type="range"
                  value={speechSdkConfig.speed}
                />
              </label>
              {speechSdkConfig.provider === 'doubao' ? (
                <>
                  <label>
                    <span>响度</span>
                    <input
                      type="number"
                      min={-10}
                      max={10}
                      step={0.1}
                      value={speechSdkConfig.loudnessRate}
                      onChange={(event) =>
                        updateSpeechSdkConfig({ loudnessRate: Number(event.currentTarget.value) })
                      }
                    />
                  </label>
                  <label>
                    <span>音调</span>
                    <input
                      type="number"
                      min={-10}
                      max={10}
                      step={0.1}
                      value={speechSdkConfig.pitchRate}
                      onChange={(event) =>
                        updateSpeechSdkConfig({ pitchRate: Number(event.currentTarget.value) })
                      }
                    />
                  </label>
                </>
              ) : null}
            </>
          ) : null}
          {speechSdkModelSupportsInstructions(speechSdkConfig) ? (
            <label className="settingsWideField">
              <span>Instructions</span>
              <input
                value={speechSdkConfig.instructions}
                onChange={(event) => updateSpeechSdkConfig({ instructions: event.currentTarget.value })}
                placeholder="温柔、自然、稍微带一点陪伴感"
              />
            </label>
          ) : null}
        </div>
      </div>
      <div className="settingsTestRow">
        <input
          aria-label="TTS test text"
          value={speechSdkTestText}
          onChange={(event) => setSpeechSdkTestText(event.currentTarget.value)}
        />
        <button
          disabled={!isSpeechSdkTtsConfigComplete(speechSdkConfig)}
          onClick={() => void testSpeechSdkVoice()}
          type="button"
        >
          <Play size={17} />
          Test Voice
        </button>
      </div>
      <p className="settingsStatus" data-error={Boolean(speechSdkSettingsError)}>
        {speechSdkSettingsError ||
          (speechSdkProviderKind === 'disabled'
            ? 'TTS 已关闭'
            : speechSdkProviderKind === 'local'
            ? '本地 Microsoft 系统语音'
            : !isSpeechSdkTtsConfigComplete(speechSdkConfig)
            ? `TTS 配置不完整，请检查 ${
                speechSdkConfig.provider === 'doubao' ? 'API Key、私有 Voice ID' : 'API Key'
              }、模型和音色。`
            : `Speech SDK · ${speechSdkConfig.provider}/${speechSdkConfig.model}`)}
      </p>
    </section>
  );
}
