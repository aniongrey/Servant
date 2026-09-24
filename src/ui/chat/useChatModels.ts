import { useEffect, useMemo, useState } from 'react';
import { AiSdkClient } from '../../ai/llm/AiSdkClient';
import { loadLlmConfig, normalizeLlmConfig, saveLlmConfig, type LlmConfig } from '../../ai/llm/LlmConfig';
import { type LlmModelInfo } from '../../ai/llm/types';
import { type CompanionChatPanelProps } from './chatTypes';

export function useChatModels({
  networkFetch,
  llmConfig,
  onLlmConfigChange
}: Pick<CompanionChatPanelProps, 'networkFetch' | 'llmConfig' | 'onLlmConfigChange'>) {
  const [localLlmConfig, setLocalLlmConfig] = useState(loadLlmConfig);

  const activeLlmConfig = llmConfig ?? localLlmConfig;

  const updateLlmConfig = (patch: Partial<LlmConfig>) => {
    const next = normalizeLlmConfig({ ...activeLlmConfig, ...patch });
    saveLlmConfig(next);
    setLocalLlmConfig(next);
    onLlmConfigChange?.(next);
  };

  const llm = useMemo(
    () => new AiSdkClient(activeLlmConfig, networkFetch),
    [
      activeLlmConfig.apiKey,
      activeLlmConfig.model,
      activeLlmConfig.provider,
      activeLlmConfig.temperature,
      networkFetch
    ]
  );

  const [models, setModels] = useState<LlmModelInfo[]>([]);

  const [llmOnline, setLlmOnline] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void llm
      .listModels(controller.signal)
      .then((available) => {
        if (controller.signal.aborted) return;
        setModels(available);
        setLlmOnline(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLlmOnline(false);
      });
    return () => controller.abort();
  }, [llm, activeLlmConfig.model]);
  return { activeLlmConfig, updateLlmConfig, llm, models, llmOnline, setLlmOnline };
}
