import { type UiPreferences } from '../../app/settings/uiPreferences';
import { LLM_CONNECTION_TEST_ENABLED_STORAGE_KEY } from '../../app/settings/storageKeys';

import { useState, useMemo } from 'react';
import {
  loadLlmConfig,
  normalizeLlmConfig,
  saveLlmConfig,
  getLlmProviderOption,
  type LlmProviderId,
  getLlmConfigForProvider,
  recommendedLlmProviderOptions,
  otherLlmProviderOptions,
  DOUBAO_LLM_OPEN_MANAGEMENT_URL,
  doubaoLlmQuickModels,
  llmModelSupportsTemperature
} from '../../ai/llm/LlmConfig';
import { createGlobalNetworkFetch } from '../../app/network/globalNetworkFetch';
import { AiSdkClient } from '../../ai/llm/AiSdkClient';
import {
  createMemoryLlmConfigForProvider,
  loadMemoryLlmConfig,
  saveMemoryLlmConfig
} from '../../ai/memory/MemoryLlmConfig';
import { BrainCircuit, Cpu, Save } from 'lucide-react';
import { PanelTitle, ControlRange, Toggle } from './SettingsControls';

export function LlmSettings({ preferences }: { preferences: UiPreferences }) {
  const [draft, setDraft] = useState(loadLlmConfig);
  const [saveMessage, setSaveMessage] = useState('配置由主页和 /debug 调试页共用。');
  const [connectionTestEnabled, setConnectionTestEnabled] = useState(
    // 初始参数：保存时默认顺带测一次连接，只有显式关掉才跳过。
    () => localStorage.getItem(LLM_CONNECTION_TEST_ENABLED_STORAGE_KEY) !== 'false'
  );
  const [testingConnection, setTestingConnection] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState(loadMemoryLlmConfig);
  const [memorySaveMessage, setMemorySaveMessage] = useState(
    '用于每日记忆提取，与主模型独立。'
  );
  const [testingMemoryConnection, setTestingMemoryConnection] = useState(false);
  const networkFetch = useMemo(
    () =>
      createGlobalNetworkFetch({
        proxyEnabled: preferences.proxyEnabled,
        proxyUrl: preferences.proxyUrl
      }),
    [preferences.proxyEnabled, preferences.proxyUrl]
  );
  const applyConfig = async () => {
    const next = normalizeLlmConfig(draft);
    saveLlmConfig(next);

    setDraft(next);
    if (!connectionTestEnabled) {
      setSaveMessage('LLM 配置已保存，Debug 聊天已切换到新配置。');
      return;
    }

    setTestingConnection(true);
    setSaveMessage('LLM 配置已保存，正在测试连接…');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      await new AiSdkClient(next, networkFetch).testConnection(
        controller.signal
      );
      setSaveMessage(`连接成功：${getLlmProviderOption(next.provider).label} · ${next.model}`);
    } catch (cause) {
      const detail =
        cause instanceof Error && cause.name === 'AbortError'
          ? '连接超时。'
          : cause instanceof Error
          ? cause.message
          : '未知错误';
      setSaveMessage(`连接失败：${detail}`);
    } finally {
      window.clearTimeout(timeout);
      setTestingConnection(false);
    }
  };
  const toggleConnectionTest = (enabled: boolean) => {
    setConnectionTestEnabled(enabled);
    localStorage.setItem(LLM_CONNECTION_TEST_ENABLED_STORAGE_KEY, String(enabled));
  };
  const applyMemoryConfig = async () => {
    const next = saveMemoryLlmConfig(memoryDraft);
    setMemoryDraft(next);
    setTestingMemoryConnection(true);
    setMemorySaveMessage('副 LLM 配置已保存，正在测试连接…');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      await new AiSdkClient(next, networkFetch).testConnection(controller.signal);
      setMemorySaveMessage(`连接成功：${getLlmProviderOption(next.provider).label} · ${next.model}`);
    } catch (cause) {
      const detail =
        cause instanceof Error && cause.name === 'AbortError'
          ? '连接超时。'
          : cause instanceof Error
          ? cause.message
          : '未知错误';
      setMemorySaveMessage(`连接失败：${detail}`);
    } finally {
      window.clearTimeout(timeout);
      setTestingMemoryConnection(false);
    }
  };
  const configuredModels = getLlmProviderOption(draft.provider).models;
  const llmProvider = getLlmProviderOption(draft.provider);
  const modelSuggestionListId = `llm-model-suggestions-${draft.provider}`;
  const memoryProvider = getLlmProviderOption(memoryDraft.provider);
  const memoryModelSuggestionListId = `memory-llm-model-suggestions-${memoryDraft.provider}`;

  return (
    <div className="aurelia-content-grid">
      <section className="aurelia-panel aurelia-panel-wide aurelia-provider-head">
        <div className="aurelia-provider-icon">
          <BrainCircuit size={26} />
        </div>
        <div>
          <span>VERCEL AI SDK · 10 PROVIDERS</span>
          <strong>云端主流模型 + 本地 Ollama</strong>
          <small>官方 Provider 适配 · 火山方舟豆包 · Zod 结构化流 · SenseVoice 实时麦克风 · 跟进调度</small>
        </div>
        <div className="aurelia-connection-state">
          <Cpu size={15} /> 实时检测
        </div>
      </section>
      <section className="aurelia-panel">
        <PanelTitle title="模型连接" eyebrow="ENDPOINT" />
        <label className="aurelia-field">
          <span>Provider</span>
          <select
            value={draft.provider}
            onChange={(event) => {
              const provider = event.currentTarget.value as LlmProviderId;
              setDraft(getLlmConfigForProvider(provider));
            }}
          >
            <optgroup label="推荐">
              {recommendedLlmProviderOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="其他">
              {otherLlmProviderOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <div className="aurelia-model-picker-row" data-has-quick-picker={draft.provider === 'doubao'}>
          {draft.provider === 'doubao' ? (
            <label className="aurelia-field">
              <span>
                快速选择
                <a href={DOUBAO_LLM_OPEN_MANAGEMENT_URL} rel="noreferrer" target="_blank">
                  快速开通豆包模型 ↗
                </a>
              </span>
              <select
                aria-label="豆包模型快速选择"
                value={doubaoLlmQuickModels.some((model) => model.id === draft.model) ? draft.model : ''}
                onChange={(event) => {
                  const model = event.currentTarget.value;
                  if (model) setDraft((current) => ({ ...current, model }));
                }}
              >
                <option value="">自定义 Model ID</option>
                {(['DeepSeek', '官方推荐', '常用模型'] as const).map((group) => (
                  <optgroup key={group} label={group}>
                    {doubaoLlmQuickModels
                      .filter((model) => model.group === group)
                      .map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
          ) : null}
          <label className="aurelia-field">
            <span>默认模型</span>
            <input
              list={modelSuggestionListId}
              value={draft.model}
              onFocus={(event) => {
                if (
                  !event.currentTarget.value.trim() &&
                  typeof event.currentTarget.showPicker === 'function'
                ) {
                  event.currentTarget.showPicker();
                }
              }}
              onChange={(event) => {
                const model = event.currentTarget.value;
                setDraft((current) => ({ ...current, model }));
              }}
              placeholder="输入模型 ID，可从候选中补全"
            />
            <datalist id={modelSuggestionListId}>
              {configuredModels.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </label>
        </div>
        {draft.provider !== 'ollama' ? (
          <label className="aurelia-field">
            <span>
              {llmProvider.apiKeyLabel}
              {llmProvider.apiKeyUrl ? (
                <a href={llmProvider.apiKeyUrl} rel="noreferrer" target="_blank">
                  获取 {llmProvider.label} API Key ↗
                </a>
              ) : null}
            </span>
            <input
              autoComplete="off"
              type="password"
              value={draft.apiKey}
              onChange={(event) => {
                const apiKey = event.currentTarget.value;
                setDraft((current) => ({ ...current, apiKey }));
              }}
              placeholder="仅保存在当前浏览器"
            />
          </label>
        ) : (
          <div className="aurelia-select-row">
            <span>本地端点</span>
            <span className="aurelia-fixed-badge">/api/ollama</span>
          </div>
        )}
        {llmModelSupportsTemperature(draft) ? (
          <ControlRange
            label="Temperature"
            min={0}
            max={2}
            step={0.1}
            value={draft.temperature}
            onChange={(temperature) => setDraft((current) => ({ ...current, temperature }))}
          />
        ) : (
          <div className="aurelia-select-row">
            <span>Temperature</span>
            <span className="aurelia-fixed-badge">模型自动管理</span>
          </div>
        )}
        <div className="aurelia-settings-actions">
          <button disabled={testingConnection} onClick={() => void applyConfig()} type="button">
            <Save size={14} /> {testingConnection ? '测试中' : '应用配置'}
          </button>
          <label className="aurelia-action-toggle">
            <span>测试连接</span>
            <Toggle
              checked={connectionTestEnabled}
              label="应用配置时测试连接"
              onChange={toggleConnectionTest}
            />
          </label>
        </div>
        <p className="aurelia-field-hint">{saveMessage}</p>
        <div className="aurelia-select-row">
          <span>全局代理</span>
          <span className="aurelia-fixed-badge" data-active={preferences.proxyEnabled}>
            {preferences.proxyEnabled ? preferences.proxyUrl : '直连'}
          </span>
        </div>
      </section>
      <section className="aurelia-panel">
        <PanelTitle title="副 LLM 记忆整理" eyebrow="MEMORY MODEL" />
        <label className="aurelia-field">
          <span>Provider</span>
          <select
            value={memoryDraft.provider}
            onChange={(event) =>
              setMemoryDraft(createMemoryLlmConfigForProvider(event.currentTarget.value as LlmProviderId))
            }
          >
            <optgroup label="推荐">
              {recommendedLlmProviderOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="其他">
              {otherLlmProviderOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label className="aurelia-field">
          <span>默认模型</span>
          <input
            list={memoryModelSuggestionListId}
            value={memoryDraft.model}
            onChange={(event) =>
              setMemoryDraft((current) => ({ ...current, model: event.currentTarget.value }))
            }
            placeholder="输入模型 ID，可从候选中补全"
          />
          <datalist id={memoryModelSuggestionListId}>
            {memoryProvider.models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </label>
        {memoryDraft.provider !== 'ollama' ? (
          <label className="aurelia-field">
            <span>
              {memoryProvider.apiKeyLabel}
              {memoryProvider.apiKeyUrl ? (
                <a href={memoryProvider.apiKeyUrl} rel="noreferrer" target="_blank">
                  获取 {memoryProvider.label} API Key ↗
                </a>
              ) : null}
            </span>
            <input
              autoComplete="off"
              type="password"
              value={memoryDraft.apiKey}
              onChange={(event) =>
                setMemoryDraft((current) => ({ ...current, apiKey: event.currentTarget.value }))
              }
              placeholder="仅保存在当前浏览器"
            />
          </label>
        ) : (
          <div className="aurelia-select-row">
            <span>本地端点</span>
            <span className="aurelia-fixed-badge">/api/ollama</span>
          </div>
        )}
        <div className="aurelia-select-row">
          <span>Temperature</span>
          <span className="aurelia-fixed-badge">0 · 稳定 JSON</span>
        </div>
        <div className="aurelia-settings-actions">
          <button disabled={testingMemoryConnection} onClick={() => void applyMemoryConfig()} type="button">
            <Save size={14} /> {testingMemoryConnection ? '测试中' : '应用副 LLM 配置'}
          </button>
        </div>
        <p className="aurelia-field-hint">{memorySaveMessage}</p>
        {memoryDraft.provider !== 'ollama' ? (
          <p className="aurelia-field-hint">云端记忆 LLM 只会接收日结所需的原始聊天。</p>
        ) : null}
      </section>
    </div>
  );
}
