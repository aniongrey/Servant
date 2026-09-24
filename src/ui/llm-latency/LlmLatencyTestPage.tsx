import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import personalityJson from '../../ai/personality/assets/companion-default.json';
import { AiSdkClient } from '../../ai/llm/AiSdkClient';
import { buildWebSearchQuery, extractPageText, parseDuckDuckGoResults } from '../../ai/llm/LlmTools';
import { createDefaultPersonalityState } from '../../ai/personality/PersonalitySystem';
import type { ChatMessage, PersonalityConfig } from '../../ai/llm/types';
import { createGlobalNetworkFetch } from '../../app/network/globalNetworkFetch';
import { backendFetch } from '../../app/network/backendFetch';
import {
  DEFAULT_GLOBAL_PROXY_URL,
  GLOBAL_PROXY_ENABLED_STORAGE_KEY,
  GLOBAL_PROXY_URL_STORAGE_KEY
} from '../../app/settings/storageKeys';

const SEARCH_URL = 'https://html.duckduckgo.com/html/';

interface Metric {
  id: number;
  label: string;
  milliseconds: number;
  detail: string;
  category: 'ollama' | 'network' | 'project';
}

interface OllamaDonePayload {
  load_duration?: number;
  prompt_eval_duration?: number;
  prompt_eval_count?: number;
  eval_duration?: number;
  eval_count?: number;
}

export function LlmLatencyTestPage() {
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('qwen3.5:9b');
  const [contextLength, setContextLength] = useState(16384);
  const [rawPrompt, setRawPrompt] = useState('请用一句中文介绍你自己。');
  const [searchQuery, setSearchQuery] = useState('Ollama official Web Search API Key');
  const [projectPrompt, setProjectPrompt] = useState(
    '请联网搜索 Ollama 官方 Web Search 是否需要 API Key，并附来源。'
  );
  const [proxyEnabled, setProxyEnabled] = useState(
    () => localStorage.getItem(GLOBAL_PROXY_ENABLED_STORAGE_KEY) === 'true'
  );
  const [proxyUrl, setProxyUrl] = useState(
    () => localStorage.getItem(GLOBAL_PROXY_URL_STORAGE_KEY) || DEFAULT_GLOBAL_PROXY_URL
  );
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [rawOutput, setRawOutput] = useState('');
  const [projectOutput, setProjectOutput] = useState('');
  const [searchOutput, setSearchOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [stopped, setStopped] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const metricIdRef = useRef(0);

  const networkFetch = useMemo(
    () => createGlobalNetworkFetch({ proxyEnabled, proxyUrl }),
    [proxyEnabled, proxyUrl]
  );
  const maxMetric = metrics.reduce<Metric | undefined>(
    (current, metric) => (!current || metric.milliseconds > current.milliseconds ? metric : current),
    undefined
  );
  const maxDuration = Math.max(1, ...metrics.map((metric) => metric.milliseconds));

  useEffect(() => {
    void backendFetch('/api/ollama/tags')
      .then(async (response) => {
        if (!response.ok) throw new Error(`Ollama unavailable (${response.status})`);
        return response.json() as Promise<{ models?: Array<{ name?: string; model?: string }> }>;
      })
      .then((body) => {
        const names = (body.models ?? []).map((item) => item.model || item.name || '').filter(Boolean);
        setModels(names);
        if (names.includes('qwen3.5:9b')) setModel('qwen3.5:9b');
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : '无法读取 Ollama 模型'));
  }, []);

  const addMetric = useCallback(
    (label: string, milliseconds: number, detail: string, category: Metric['category']) => {
      setMetrics((current) => [
        ...current,
        {
          id: ++metricIdRef.current,
          label,
          milliseconds: Math.max(0, milliseconds),
          detail,
          category
        }
      ]);
    },
    []
  );
  const addLog = (message: string) => {
    const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setLogs((current) => [...current, `${stamp}  ${message}`]);
  };

  // Keep transport identity stable between runs, just like the real conversation client.
  const traceFetch = useMemo<typeof fetch>(
    () => async (input, init) => {
      const raw = input instanceof Request ? input.url : input.toString();
      const startedAt = performance.now();
      const response = await networkFetch(input, init);
      const isModel = raw.includes('/api/ollama/chat');
      addMetric(
        isModel
          ? '项目 Ollama 响应头'
          : raw.includes('html.duckduckgo.com')
          ? '项目搜索响应头'
          : '项目正文响应头',
        performance.now() - startedAt,
        `${raw} · 单次请求，不含此前搜索耗时`,
        isModel ? 'project' : 'network'
      );
      return response;
    },
    [networkFetch, addMetric]
  );

  const execute = async (runner: (signal: AbortSignal) => Promise<void>, reset = true) => {
    if (running) return;
    if (reset) {
      setMetrics([]);
      setLogs([]);
      setRawOutput('');
      setProjectOutput('');
      setSearchOutput('');
    }
    setError('');
    setStopped(false);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await runner(controller.signal);
    } catch (cause) {
      if (controller.signal.aborted) setStopped(true);
      else setError(cause instanceof Error ? cause.message : '诊断失败');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setRunning(false);
    }
  };

  const testConnection = async (signal: AbortSignal) => {
    addLog('检查 Ollama 服务与模型列表');
    const startedAt = performance.now();
    const response = await backendFetch('/api/ollama/tags', { signal });
    await response.text();
    if (!response.ok) throw new Error(`Ollama 连接失败 (${response.status})`);
    addMetric('Ollama 服务连接', performance.now() - startedAt, 'GET /api/ollama/tags', 'ollama');
  };

  const testRawOllama = async (signal: AbortSignal) => {
    addLog(`原始流测试：${model}，context=${contextLength}，thinking=false`);
    const startedAt = performance.now();
    const response = await backendFetch('/api/ollama/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: rawPrompt }],
        stream: true,
        think: false,
        keep_alive: '30m',
        options: { num_ctx: contextLength, num_predict: 96, temperature: 0.2 }
      }),
      signal
    });
    const headersAt = performance.now();
    if (!response.ok || !response.body) throw new Error(`原始 Ollama 请求失败 (${response.status})`);
    addMetric('原始请求响应头', headersAt - startedAt, '到 Ollama 开始返回流', 'ollama');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let output = '';
    let firstTokenAt: number | undefined;
    let donePayload: OllamaDonePayload = {};
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = done ? '' : lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const payload = JSON.parse(line) as OllamaDonePayload & {
          done?: boolean;
          message?: { content?: string; thinking?: string };
        };
        const delta = payload.message?.content || payload.message?.thinking || '';
        if (delta && firstTokenAt === undefined) firstTokenAt = performance.now();
        output += delta;
        if (payload.done) donePayload = payload;
      }
      if (done) break;
    }
    const finishedAt = performance.now();
    setRawOutput(output.trim() || '（无文本输出）');
    addMetric(
      '原始 LLM 首 token',
      (firstTokenAt ?? finishedAt) - startedAt,
      '用户感知的第一段模型输出',
      'ollama'
    );
    addMetric(
      '原始 LLM 总耗时',
      finishedAt - startedAt,
      `${donePayload.eval_count ?? 0} 个输出 token`,
      'ollama'
    );
    addOllamaServerMetrics(donePayload, addMetric);
    addMetric(
      '去除加载后净耗时',
      Math.max(0, finishedAt - startedAt - nanosecondsToMilliseconds(donePayload.load_duration)),
      '总耗时减去 Ollama load_duration',
      'ollama'
    );
  };

  const testSearch = async (signal: AbortSignal) => {
    const normalizedQuery = buildWebSearchQuery(searchQuery);
    addLog(`联网搜索：${normalizedQuery}`);
    const totalStartedAt = performance.now();
    const indexStartedAt = performance.now();
    const response = await networkFetch(`${SEARCH_URL}?q=${encodeURIComponent(normalizedQuery)}`, {
      headers: { Accept: 'text/html,application/xhtml+xml' },
      signal
    });
    const html = await response.text();
    if (!response.ok) throw new Error(`搜索页请求失败 (${response.status})`);
    addMetric('搜索结果页', performance.now() - indexStartedAt, 'DuckDuckGo HTML', 'network');
    const results = parseDuckDuckGoResults(html).slice(0, 5);
    if (results.length === 0) throw new Error('搜索没有返回可解析结果');

    const enriched = await Promise.all(
      results.slice(0, 2).map(async (result, index) => {
        const pageStartedAt = performance.now();
        const pageResponse = await networkFetch(result.url, { signal });
        const content = pageResponse.ok ? extractPageText(await pageResponse.text()).slice(0, 5000) : '';
        addMetric(`正文抓取 ${index + 1}`, performance.now() - pageStartedAt, result.url, 'network');
        return { ...result, contentLength: content.length };
      })
    );
    addMetric('联网工具总耗时', performance.now() - totalStartedAt, '搜索页 + 前两篇正文并行抓取', 'network');
    setSearchOutput(
      enriched.map((item) => `${item.title}\n${item.url}\n正文 ${item.contentLength} 字符`).join('\n\n')
    );
  };

  const testProjectPipeline = async (signal: AbortSignal) => {
    addLog('运行项目 AiSdkClient 主模型链路');
    const client = new AiSdkClient(
      { provider: 'ollama', model, apiKey: '', temperature: 0.7 },
      traceFetch,
      (event) => {
        addMetric('项目模型生成及校验', event.milliseconds, '主模型单次生成', 'project');
      }
    );
    const personality = personalityJson as PersonalityConfig;
    const state = createDefaultPersonalityState(personality);
    const history: ChatMessage[] = [
      {
        id: crypto.randomUUID(),
        role: 'user',
        text: projectPrompt,
        createdAt: Date.now()
      }
    ];
    const startedAt = performance.now();
    let firstSpeechAt: number | undefined;
    const intent = await client.chat(personality, state, history, signal, undefined, (event) => {
      if (event.type === 'first-speech' && firstSpeechAt === undefined) firstSpeechAt = performance.now();
    });
    const finishedAt = performance.now();
    if (firstSpeechAt !== undefined) {
      addMetric(
        '项目首段台词',
        firstSpeechAt - startedAt,
        '从点击开始累计，已包含工具准备和 Ollama 等待；不可与响应头相加',
        'project'
      );
      addMetric('模型开始至首段台词', firstSpeechAt - startedAt, '主模型首段等待', 'project');
    }
    addMetric('项目完整回复', finishedAt - startedAt, '从点击开始累计：主模型生成及校验', 'project');
    setProjectOutput(JSON.stringify(intent, null, 2));
  };

  const runAll = (signal: AbortSignal) =>
    testConnection(signal)
      .then(() => testRawOllama(signal))
      .then(() => testSearch(signal))
      .then(() => testProjectPipeline(signal));

  return (
    <main className="latencyShell">
      <header className="latencyHeader">
        <div>
          <span>SHIRO DIAGNOSTICS</span>
          <h1>LLM 延迟拆解测试台</h1>
          <p>原始 Ollama · 联网工具 · 项目结构化回复</p>
        </div>
        <nav>
          <a href="/">返回主页</a>
          <a href="/pages/interaction-test.html">互动测试台</a>
        </nav>
      </header>

      <section className="configCard">
        <label>
          <span>Ollama 模型</span>
          <select value={model} onChange={(event) => setModel(event.currentTarget.value)}>
            {models.length ? (
              models.map((name) => <option key={name}>{name}</option>)
            ) : (
              <option>{model}</option>
            )}
          </select>
        </label>
        <label>
          <span>原始测试 Context</span>
          <select
            value={contextLength}
            onChange={(event) => setContextLength(Number(event.currentTarget.value))}
          >
            <option value={4096}>4096</option>
            <option value={8192}>8192</option>
            <option value={16384}>16384</option>
          </select>
        </label>
        <label className="toggleLabel">
          <input
            checked={proxyEnabled}
            onChange={(event) => setProxyEnabled(event.currentTarget.checked)}
            type="checkbox"
          />
          联网使用全局代理
        </label>
        <label>
          <span>代理地址</span>
          <input
            disabled={!proxyEnabled}
            value={proxyUrl}
            onChange={(event) => setProxyUrl(event.currentTarget.value)}
          />
        </label>
      </section>

      <section className="promptGrid">
        <label>
          <span>原始 LLM 问题</span>
          <textarea value={rawPrompt} onChange={(event) => setRawPrompt(event.currentTarget.value)} />
        </label>
        <label>
          <span>搜索关键词</span>
          <textarea value={searchQuery} onChange={(event) => setSearchQuery(event.currentTarget.value)} />
        </label>
        <label>
          <span>项目完整链路问题</span>
          <textarea value={projectPrompt} onChange={(event) => setProjectPrompt(event.currentTarget.value)} />
        </label>
      </section>

      <section className="actionBar">
        <button className="primary" disabled={running} onClick={() => void execute(runAll)}>
          运行完整诊断
        </button>
        <button disabled={running} onClick={() => void execute(testRawOllama)}>
          仅测原始 LLM
        </button>
        <button disabled={running} onClick={() => void execute(testSearch)}>
          仅测联网搜索
        </button>
        <button disabled={running} onClick={() => void execute(testProjectPipeline)}>
          仅测项目链路
        </button>
        <button className="stop" disabled={!running} onClick={() => abortRef.current?.abort()}>
          停止
        </button>
      </section>

      {error ? <div className="errorBox">{error}</div> : null}
      <section className="summaryCard">
        <div>
          <span>状态</span>
          <strong data-running={running}>
            {running
              ? '测试运行中…'
              : error
              ? '测试失败'
              : stopped
              ? '测试已停止'
              : metrics.length
              ? '测试完成'
              : '等待开始'}
          </strong>
        </div>
        <div>
          <span>最大耗时项</span>
          <strong>{maxMetric ? `${maxMetric.label} · ${formatMs(maxMetric.milliseconds)}` : '—'}</strong>
        </div>
        <div>
          <span>初步判断</span>
          <strong>
            {running ? '等待完整结果' : error || stopped ? '未完成，不能判定通过' : diagnose(metrics)}
          </strong>
        </div>
        <div>
          <span>项目 2 秒验收</span>
          <strong>
            {running || error || stopped
              ? '未完成验收'
              : metrics.some((metric) => metric.label === '项目完整回复')
              ? metrics.find((metric) => metric.label === '项目完整回复')!.milliseconds < 2000
                ? '通过（本轮）'
                : '未达标（本轮）'
              : '尚未运行项目链路'}
          </strong>
        </div>
      </section>

      <section className="metricsCard">
        <header>
          <h2>阶段耗时</h2>
          <span>绿色 &lt; 1s · 黄色 1–5s · 红色 &gt; 5s</span>
        </header>
        <p className="metricLegend">
          父项包含子项，点击可收起。并行请求与累计时间不可重复相加；条形长度统一按最长耗时比较。
        </p>
        {metrics.length === 0 ? (
          <p className="empty">运行测试后会在这里显示时间线。</p>
        ) : (
          <ul className="metricTree">
            {buildMetricHierarchy(metrics).map((node) => (
              <MetricTreeItem key={node.key} node={node} maxDuration={maxDuration} />
            ))}
          </ul>
        )}
      </section>

      <section className="outputGrid">
        <Output title="原始 Ollama 输出" value={rawOutput} />
        <Output title="联网搜索结果" value={searchOutput} />
        <Output title="项目结构化输出" value={projectOutput} />
      </section>
      <section className="logCard">
        <h2>诊断日志</h2>
        <pre>{logs.join('\n') || '尚无日志'}</pre>
      </section>
    </main>
  );
}

function Output({ title, value }: { title: string; value: string }) {
  return (
    <article>
      <h2>{title}</h2>
      <pre>{value || '尚无结果'}</pre>
    </article>
  );
}

interface MetricNode {
  key: string;
  label: string;
  metric?: Metric;
  note?: string;
  children: MetricNode[];
}

function buildMetricHierarchy(metrics: Metric[]): MetricNode[] {
  const used = new Set<number>();
  const leaves = (...labels: string[]): MetricNode[] =>
    metrics
      .filter((metric) => labels.includes(metric.label))
      .map((metric) => {
        used.add(metric.id);
        return { key: String(metric.id), label: metric.label, metric, children: [] };
      });
  const group = (label: string, children: MetricNode[], note: string): MetricNode[] => {
    const metric = metrics.find((item) => item.label === label);
    if (!metric && children.length === 0) return [];
    if (metric) used.add(metric.id);
    return [{ key: label, label, metric, note, children }];
  };
  const project = group(
    '项目完整回复',
    [
      ...group(
        '项目工具准备',
        leaves('项目搜索响应头', '项目正文响应头'),
        '包含搜索和正文读取；两篇正文并行，响应头仅为请求的一部分。'
      ),
      ...group(
        '项目模型生成及校验',
        [
          ...group(
            '模型开始至首段台词',
            leaves('项目 Ollama 响应头'),
            '已包含响应头等待；之后模型继续生成并完成校验。'
          )
        ],
        '从模型开始到完整结构返回，包含首段等待和后续生成。'
      ),
      ...leaves('项目首段台词').map((node) => ({
        ...node,
        note: '累计观察点：工具准备 + 模型首段等待，与上面的阶段重叠，不再相加。'
      }))
    ],
    '总耗时 ≈ 工具准备 + 模型生成及校验；首段台词是累计观察点。'
  );
  const raw = group(
    '原始 LLM 总耗时',
    [
      ...leaves('模型加载', 'Prompt 处理', 'Token 生成'),
      ...group(
        '原始 LLM 首 token',
        leaves('原始请求响应头'),
        '累计观察点，包含响应头等待；与服务端阶段重叠。'
      ),
      ...leaves('去除加载后净耗时').map((node) => ({
        ...node,
        note: '派生值：总耗时减去加载，不能再与其他子项相加。'
      }))
    ],
    '包含服务端加载、输入处理和生成；首 token 与净耗时为重叠观察值。'
  );
  const search = group(
    '联网工具总耗时',
    leaves('搜索结果页', '正文抓取 1', '正文抓取 2'),
    '搜索完成后并行抓取正文，两篇正文耗时不可相加。'
  );
  return [
    ...leaves('Ollama 服务连接'),
    ...raw,
    ...search,
    ...project,
    ...metrics
      .filter((metric) => !used.has(metric.id))
      .map((metric) => ({ key: String(metric.id), label: metric.label, metric, children: [] }))
  ];
}

function MetricTreeItem({ node, maxDuration }: { node: MetricNode; maxDuration: number }) {
  const metric = node.metric;
  const row = (
    <>
      <div className="metricName">
        <span data-category={metric?.category ?? 'project'}>
          {node.children.length ? '包含子项' : metric?.category}
        </span>
        <strong>{node.label}</strong>
        <small title={metric?.detail}>{metric?.detail ?? '总耗时尚未返回，先展示已收到的子项'}</small>
        {node.note && <em>{node.note}</em>}
      </div>
      <div className="barTrack">
        {metric && (
          <i
            data-tone={latencyTone(metric.milliseconds)}
            style={{ width: `${Math.max(2, (metric.milliseconds / maxDuration) * 100)}%` }}
          />
        )}
      </div>
      <b data-tone={metric ? latencyTone(metric.milliseconds) : undefined}>
        {metric ? formatMs(metric.milliseconds) : '未完成'}
      </b>
    </>
  );
  return (
    <li className="metricTreeItem">
      {node.children.length ? (
        <details open>
          <summary className="metricRow">{row}</summary>
          <ul className="metricTreeChildren">
            {node.children.map((child) => (
              <MetricTreeItem key={child.key} node={child} maxDuration={maxDuration} />
            ))}
          </ul>
        </details>
      ) : (
        <div className="metricRow">{row}</div>
      )}
    </li>
  );
}

function addOllamaServerMetrics(
  payload: OllamaDonePayload,
  addMetric: (label: string, milliseconds: number, detail: string, category: Metric['category']) => void
) {
  const loadMs = nanosecondsToMilliseconds(payload.load_duration);
  const promptMs = nanosecondsToMilliseconds(payload.prompt_eval_duration);
  const evalMs = nanosecondsToMilliseconds(payload.eval_duration);
  addMetric('模型加载', loadMs, '冷启动时通常明显增大', 'ollama');
  addMetric('Prompt 处理', promptMs, `${payload.prompt_eval_count ?? 0} 个输入 token`, 'ollama');
  const tokensPerSecond = evalMs > 0 ? (((payload.eval_count ?? 0) / evalMs) * 1000).toFixed(1) : '0';
  addMetric('Token 生成', evalMs, `${tokensPerSecond} token/s`, 'ollama');
}

function nanosecondsToMilliseconds(value: number | undefined): number {
  return typeof value === 'number' ? value / 1_000_000 : 0;
}

function formatMs(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
}

function latencyTone(value: number): 'fast' | 'medium' | 'slow' {
  return value > 5000 ? 'slow' : value >= 1000 ? 'medium' : 'fast';
}

function diagnose(metrics: Metric[]): string {
  if (metrics.length === 0) return '运行后自动判断';
  const valueOf = (label: string) => metrics.find((metric) => metric.label === label)?.milliseconds ?? 0;
  const modelLoad = valueOf('模型加载');
  const promptEval = valueOf('Prompt 处理');
  const tokenEval = valueOf('Token 生成');
  const networkTotal = valueOf('联网工具总耗时');
  const projectTotal = valueOf('项目完整回复');
  if (projectTotal > 0) {
    const tools = valueOf('项目工具准备');
    const model = valueOf('项目模型生成及校验');
    return projectTotal < 2000
      ? '本轮完整回复低于2秒；首次联网与缓存结果须分开比较'
      : tools > model
      ? '未达2秒：联网工具准备占主导'
      : '未达2秒：模型处理与生成占主导';
  }
  if (modelLoad > 1000 && modelLoad > promptEval + tokenEval)
    return '模型冷启动占主导；保持 Ollama 热加载可改善';
  if (networkTotal > 3000 && networkTotal > tokenEval) return '联网或代理耗时占主导';
  if (promptEval > 1500 && promptEval > tokenEval) return 'Prompt 处理偏慢；可缩短历史或降低 context';
  if (tokenEval > 3000) return '9B 模型 token 生成占主导';
  return '当前热加载性能正常，未发现明显瓶颈';
}
