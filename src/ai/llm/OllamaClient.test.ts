import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiSdkClient, buildSystemPrompt, validateAssistantIntent } from './AiSdkClient';
import { defaultReplyShortActionId } from '../../character/motion/reply/shortActionVocabulary';
import {
  DEEPSEEK_API_KEYS_URL,
  LLM_CONFIG_STORAGE_KEY,
  DOUBAO_LLM_API_KEYS_URL,
  DOUBAO_LLM_OPEN_MANAGEMENT_URL,
  doubaoLlmQuickModels,
  getLlmProviderOption,
  llmModelSupportsTemperature,
  llmProviderOptions,
  loadLlmConfig,
  normalizeLlmConfig,
  otherLlmProviderOptions,
  recommendedLlmProviderOptions,
  saveLlmConfig
} from './LlmConfig';
import type { PersonalityConfig, PersonalityState } from './types';

describe('validateAssistantIntent', () => {
  it('normalizes the reply and clamps intensity', () => {
    const intent = validateAssistantIntent(
      '```json\n{"speech":"你好呀","emotion":"happy","intensity":2}\n```'
    );

    expect(intent).toEqual({
      replies: [{ speech: '你好呀', emotion: 'happy', intensity: 1, shortAction: defaultReplyShortActionId }],
      speech: '你好呀',
      soulEvent: 'chat',
      emotion: 'happy',
      intensity: 1,
      memories: []
    });
  });

  it('drops the removed action field even when the model still emits it', () => {
    const intent = validateAssistantIntent(
      '{"speech":"我来试试","emotion":"neutral","action":"pointing","intensity":0.5}'
    );

    expect(intent).not.toHaveProperty('action');
  });

  it('ignores legacy TTS fields in the main conversation response', () => {
    const intent = validateAssistantIntent(
      '{"speech":"今天也辛苦啦","ttsSpeech":"今日もお疲れさま。","emotion":"happy","intensity":0.7}'
    );

    expect(intent.speech).toBe('今天也辛苦啦');
    expect(intent).not.toHaveProperty('ttsSpeech');
  });

  it('keeps search sources visible in the main response', () => {
    const intent = validateAssistantIntent(
      JSON.stringify({
        speech: '需要 API Key。https://docs.ollama.com/capabilities/web-search',
        ttsSpeech: '需要 API Key。https://docs.ollama.com/capabilities/web-search',
        emotion: 'neutral',
        intensity: 0.5,
        memories: []
      })
    );

    expect(intent.speech).toContain('https://docs.ollama.com');
  });

  it('normalizes memoir candidates from the structured response', () => {
    const intent = validateAssistantIntent(
      JSON.stringify({
        speech: '我记住了。',
        emotion: 'neutral',
        intensity: 0.4,
        memories: [
          { category: 'preference', title: '喜欢咖啡', content: '用户偏爱浅烘咖啡。', importance: 8 },
          { category: 'unsupported', title: '无效', content: '不会保存', importance: 3 }
        ]
      })
    );

    expect(intent.memories).toEqual([
      {
        category: 'preference',
        title: '喜欢咖啡',
        content: '用户偏爱浅烘咖啡。',
        importance: 5
      }
    ]);
    const prompt = buildSystemPrompt(testConfig, testState);
    expect(prompt).toContain('没有合适内容时 memories=[]');
    expect(prompt.indexOf('输出必须为三个json对象')).toBeLessThan(prompt.indexOf('当前状态：'));
  });

  it('keeps language conversion and TTS tags out of the main conversation prompt', () => {
    const prompt = buildSystemPrompt(testConfig, testState);
    expect(prompt).not.toContain('ttsSpeech');
    expect(prompt).not.toContain('转换成英语');
    expect(prompt).toContain('输出必须为2个json对象');
  });
});

describe('normalizeLlmConfig', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('offers the nine curated Vercel AI SDK providers', () => {
    expect(llmProviderOptions.map((option) => option.id)).toEqual([
      'ollama',
      'openai',
      'anthropic',
      'google',
      'xai',
      'mistral',
      'groq',
      'deepseek',
      'cohere',
      'doubao'
    ]);
    expect(llmProviderOptions.every((option) => option.models.length > 0)).toBe(true);
  });

  it('groups recommended providers first and alphabetizes the remaining providers', () => {
    expect(recommendedLlmProviderOptions.map((option) => option.id)).toEqual([
      'ollama',
      'deepseek',
      'doubao'
    ]);
    expect(otherLlmProviderOptions.map((option) => option.label)).toEqual([
      'Anthropic',
      'Cohere',
      'Google Gemini',
      'Groq',
      'Mistral AI',
      'OpenAI',
      'xAI Grok'
    ]);
  });

  it('normalizes the new provider config and clamps sampling temperature', () => {
    expect(
      normalizeLlmConfig({
        provider: 'ollama',
        model: ' qwen3.5:9b ',
        apiKey: '',
        temperature: 3
      })
    ).toEqual({
      provider: 'ollama',
      model: 'qwen3.5:9b',
      apiKey: '',
      temperature: 2
    });
  });

  it('keeps a manually entered model id for any provider', () => {
    expect(normalizeLlmConfig({ provider: 'openai', model: 'future-model-id' }).model).toBe(
      'future-model-id'
    );
  });

  it('offers current Doubao and DeepSeek quick model ids without blocking custom ids', () => {
    expect(
      doubaoLlmQuickModels.filter((model) => model.group === 'DeepSeek').map((model) => model.id)
    ).toEqual([
      'deepseek-v4-pro-ga-260813',
      'deepseek-v4-flash-ga-260731',
      'deepseek-v4-pro-260425',
      'deepseek-v4-flash-260425'
    ]);
    expect(getLlmProviderOption('doubao').defaultModel).toBe('doubao-seed-2-1-turbo-260628');
    expect(DOUBAO_LLM_API_KEYS_URL).toBe(
      'https://console.volcengine.com/ark/region:cn-beijing/apiKey?apikey=%7B%7D'
    );
    expect(DEEPSEEK_API_KEYS_URL).toBe('https://platform.deepseek.com/api_keys');
    expect(DOUBAO_LLM_OPEN_MANAGEMENT_URL).toContain('/openManagement?LLM=%7B%7D');
    expect(normalizeLlmConfig({ provider: 'doubao', model: 'custom-endpoint-id' }).model).toBe(
      'custom-endpoint-id'
    );
  });

  it('uses temperature only for models that support sampling', () => {
    expect(llmModelSupportsTemperature({ provider: 'anthropic', model: 'claude-sonnet-5' })).toBe(true);
    expect(llmModelSupportsTemperature({ provider: 'openai', model: 'gpt-5.6-luna' })).toBe(false);
    expect(llmModelSupportsTemperature({ provider: 'deepseek', model: 'deepseek-reasoner' })).toBe(false);
  });

  it('persists and reloads temperature with the selected model', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    });

    saveLlmConfig({ provider: 'ollama', model: 'qwen-custom:42', apiKey: '', temperature: 1.3 });

    expect(JSON.parse(values.get(LLM_CONFIG_STORAGE_KEY) ?? '{}')).toMatchObject({ temperature: 1.3 });
    expect(loadLlmConfig()).toMatchObject({ model: 'qwen-custom:42', temperature: 1.3 });
  });
});

describe('AiSdkClient connection test', () => {
  it('always streams the Chinese message protocol without a translated field', async () => {
    let requestBody: Record<string, any> = {};
    let finishStream: (() => void) | undefined;
    const encoder = new TextEncoder();
    const networkFetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      requestBody = JSON.parse(init?.body as string);
      return new Response(
        new ReadableStream({
          start(controller) {
            const emit = (content: string, done = false) =>
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({
                    model: 'qwen3.5:9b',
                    created_at: new Date().toISOString(),
                    message: { role: 'assistant', content },
                    done,
                    ...(done ? { done_reason: 'stop', eval_count: 20, prompt_eval_count: 10 } : {})
                  }) + '\n'
                )
              );
            emit('{"speech":"你好呀。后面再说"}');
            finishStream = () => {
              emit(
                '{"emotion":"happy","intensity":0.5,"shortAction":"happy_small"}' +
                  '{"replies":[],"soulEvent":"chat","action":null,"memories":[]}'
              );
              emit('', true);
              controller.close();
            };
          }
        }),
        { headers: { 'Content-Type': 'application/x-ndjson' } }
      );
    });
    const debug = { writeRequest: vi.fn(), writeResponse: vi.fn() };
    const client = new AiSdkClient(normalizeLlmConfig(undefined), networkFetch as typeof fetch, undefined, debug);
    const events: string[] = [];
    const intent = await client.chat(
      testConfig,
      testState,
      [
        {
          id: 'test',
          role: 'user',
          text: '你好',
          createdAt: 0
        }
      ],
      undefined,
      undefined,
      (event) => {
        events.push(event.type);
        if (event.type === 'first-speech') {
          const finish = finishStream;
          finishStream = undefined;
          finish?.();
        }
      }
    );
    expect(events[0]).toBe('first-speech');
    expect(events[1]).toBe('first-parameters');
    expect(events.at(-1)).toBe('intent');
    expect(intent.replies).toEqual([
      {
        speech: '你好呀。后面再说',
        emotion: 'happy',
        intensity: 0.5,
        shortAction: 'happy_small'
      }
    ]);
    expect(requestBody.think).toBe(false);
    expect(requestBody.options.num_ctx).toBe(8192);
    expect(requestBody.format).toBeUndefined();
    expect(JSON.stringify(requestBody.messages)).not.toContain('ttsSpeech');
    expect(debug.writeRequest).toHaveBeenCalledWith(
      expect.objectContaining({ messages: [{ role: 'user', content: '你好' }] })
    );
    expect(debug.writeResponse).toHaveBeenCalledWith(
      '{"speech":"你好呀。后面再说"}{"emotion":"happy","intensity":0.5,"shortAction":"happy_small"}{"replies":[],"soulEvent":"chat","action":null,"memories":[]}'
    );
  });

  it('rejects an incomplete prioritized reply protocol', async () => {
    const encoder = new TextEncoder();
    const networkFetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `${JSON.stringify({
                    model: 'qwen3.5:9b',
                    created_at: new Date().toISOString(),
                    message: {
                      role: 'assistant',
                      content: '{"speech":"我已经完整回答了。"}'
                    },
                    done: false
                  })}\n`
                )
              );
              controller.enqueue(
                encoder.encode(
                  `${JSON.stringify({
                    model: 'qwen3.5:9b',
                    created_at: new Date().toISOString(),
                    message: { role: 'assistant', content: '' },
                    done: true,
                    done_reason: 'stop'
                  })}\n`
                )
              );
              controller.close();
            }
          }),
          { headers: { 'Content-Type': 'application/x-ndjson' } }
        )
    );
    const client = new AiSdkClient(normalizeLlmConfig(undefined), networkFetch as typeof fetch);
    const events: string[] = [];

    await expect(
      client.chat(
        testConfig,
        testState,
        [{ id: 'test', role: 'user', text: '继续', createdAt: 0 }],
        undefined,
        undefined,
        (event) => events.push(event.type)
      )
    ).rejects.toThrow('优先回复协议不完整');

    expect(events).toEqual(['first-speech']);
    expect(networkFetch).toHaveBeenCalledTimes(2);
  });

  it('checks that the configured Ollama model is available', async () => {
    const networkFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            models: [{ name: 'qwen3.5:9b', model: 'qwen3.5:9b' }]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );
    const client = new AiSdkClient(normalizeLlmConfig(undefined), networkFetch as typeof fetch);

    await expect(client.testConnection()).resolves.toBeUndefined();
    expect(networkFetch).toHaveBeenCalledWith('/api/ollama/tags', { signal: undefined });
  });

  it('reports a reachable Ollama endpoint with a missing model', async () => {
    const networkFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ models: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
    );
    const client = new AiSdkClient(normalizeLlmConfig(undefined), networkFetch as typeof fetch);

    await expect(client.testConnection()).rejects.toThrow('未找到模型 qwen3.5:9b');
  });
});

const testConfig: PersonalityConfig = {
  id: 'test',
  displayName: '测试角色',
  identity: '陪伴者',
  traits: [],
  speakingStyle: [],
  boundaries: [],
  defaultEmotion: 'neutral'
};

const testState: PersonalityState = {
  mood: 'neutral',
  energy: 0.5,
  engagement: 0.5,
  lastInteractionAt: 0,
  recentTopics: [],
  frozen: false
};
