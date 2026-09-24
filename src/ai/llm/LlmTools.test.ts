import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildWebSearchQuery,
  extractPageText,
  getCurrentTime,
  parseDuckDuckGoResults,
  searchWeb
} from './LlmTools';

const searchHtml = `
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.ollama.com%2Fcapabilities%2Fweb%2Dsearch&amp;rut=abc">
    Web <b>search</b> - Ollama
  </a>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.ollama.com%2Fcapabilities%2Fweb%2Dsearch">
    Ollama&#x27;s web search API provides <b>latest</b> information.
  </a>
  <a rel="nofollow" class="result__a" href="https://example.com/news">Example News</a>
  <a class="result__snippet" href="https://example.com/news">A second result &amp; summary.</a>
`;

describe('Ollama conversation tools', () => {
  afterEach(() => vi.useRealTimers());

  it('reuses successful searches for 60 seconds and isolates transports and result limits', async () => {
    vi.useFakeTimers();
    const transport = () => vi.fn(async () => new Response(searchHtml));
    const first = transport();
    expect((await searchWeb('same query', 1, first)).cacheHit).toBe(false);
    const cached = await searchWeb('same query', 1, first);
    expect(cached.cacheHit).toBe(true);
    cached.results[0].title = 'mutated';
    expect((await searchWeb('same query', 1, first)).results[0].title).not.toBe('mutated');
    expect(first).toHaveBeenCalledTimes(2);
    expect((await searchWeb('same query', 2, first)).cacheHit).toBe(false);
    expect((await searchWeb('same query', 1, transport())).cacheHit).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await searchWeb('same query', 1, first)).cacheHit).toBe(false);
    const controller = new AbortController();
    controller.abort();
    await expect(searchWeb('same query', 1, first, controller.signal)).rejects.toMatchObject({
      name: 'AbortError'
    });
  });

  it('does not cache failed searches', async () => {
    const networkFetch = vi.fn(async () => new Response('unavailable', { status: 503 }));
    await expect(searchWeb('same query', 1, networkFetch)).rejects.toThrow();
    await expect(searchWeb('same query', 1, networkFetch)).rejects.toThrow();
    expect(networkFetch).toHaveBeenCalledTimes(2);
  });

  it('keeps article content instead of navigation in the model context', () => {
    expect(
      extractPageText(
        '<nav>Products</nav><main><header>Menu</header><p>API key required.</p></main><footer>Legal</footer>'
      )
    ).toBe('API key required.');
  });

  it('falls back to snippets when page bodies exceed the enrichment budget', async () => {
    vi.useFakeTimers();
    const networkFetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      if (networkFetch.mock.calls.length === 1) return new Response(searchHtml);
      return new Response(
        new ReadableStream({
          start(stream) {
            init?.signal?.addEventListener('abort', () => stream.error(init.signal?.reason), { once: true });
          }
        })
      );
    });
    const pending = searchWeb('test query', 2, networkFetch as typeof fetch);
    await vi.advanceTimersByTimeAsync(1500);
    expect((await pending).results).toEqual(parseDuckDuckGoResults(searchHtml));
  });

  it('propagates cancellation during enrichment instead of returning stale results', async () => {
    const controller = new AbortController();
    const networkFetch = vi.fn(async () => {
      if (networkFetch.mock.calls.length === 1) return new Response(searchHtml);
      controller.abort();
      throw controller.signal.reason;
    });
    await expect(
      searchWeb('test query', 1, networkFetch as typeof fetch, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('returns the computer time with local and UTC representations', () => {
    expect(getCurrentTime(new Date('2026-09-02T07:38:28.000Z'))).toMatchObject({
      utcTime: '2026-09-02T07:38:28.000Z'
    });
  });

  it('removes chat instructions from the search-engine query', () => {
    expect(buildWebSearchQuery('请查询 Ollama 官方 Web Search 是否需要 API Key，并附来源。')).toBe(
      'Ollama 官方 Web Search 是否需要 API Key'
    );
  });

  it('parses titles, snippets and destination URLs from DuckDuckGo HTML', () => {
    expect(parseDuckDuckGoResults(searchHtml)).toEqual([
      {
        title: 'Web search - Ollama',
        url: 'https://docs.ollama.com/capabilities/web-search',
        snippet: "Ollama's web search API provides latest information."
      },
      {
        title: 'Example News',
        url: 'https://example.com/news',
        snippet: 'A second result & summary.'
      }
    ]);
  });

  it('extracts readable page text while removing executable content', () => {
    expect(
      extractPageText(
        '<main><h1>Authentication</h1><p>Create an API key.</p><script>ignore()</script></main>'
      )
    ).toBe('Authentication Create an API key.');
  });

  it('uses the configured application network transport and result limit', async () => {
    const controller = new AbortController();
    const networkFetch = vi.fn(
      async () =>
        new Response(searchHtml, {
          status: 200,
          headers: { 'Content-Type': 'text/html' }
        })
    );

    const result = await searchWeb(' Ollama Web Search ', 1, networkFetch as typeof fetch, controller.signal);

    expect(result.results).toHaveLength(1);
    expect(networkFetch).toHaveBeenCalledWith(
      'https://html.duckduckgo.com/html/?q=Ollama%20Web%20Search',
      expect.objectContaining({ signal: controller.signal })
    );
  });

  it('reports an upstream search failure', async () => {
    const networkFetch = vi.fn(async () => new Response('blocked', { status: 503 }));
    await expect(searchWeb('latest news', 5, networkFetch as typeof fetch)).rejects.toThrow(
      '联网搜索失败 (503)'
    );
  });
});
