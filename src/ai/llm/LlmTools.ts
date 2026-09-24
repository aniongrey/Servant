const DUCKDUCKGO_HTML_SEARCH_URL = 'https://html.duckduckgo.com/html/';
const DEFAULT_SEARCH_RESULTS = 5;
const SEARCH_CACHE_TTL_MS = 60_000;
export type SearchResponse = { query: string; results: WebSearchResult[]; cacheHit: boolean };
// Isolate caches by transport so switching proxy settings cannot reuse another route's results.
const searchCaches = new WeakMap<typeof fetch, Map<string, { expiresAt: number; value: SearchResponse }>>();

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
}

export function buildWebSearchQuery(text: string): string {
  const query = text
    .replace(/(?:请)?(?:帮我|帮忙|给我|替我)?(?:联网)?(?:查询(?:一下)?|查一下)\s*/gi, ' ')
    .replace(/(?:，|,)?\s*(?:并|然后)?\s*(?:附上?|给出|注明)?\s*(?:相关)?来源(?:链接)?[。.!！]?\s*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return query.slice(0, 160);
}

export function getCurrentTime(now: Date = new Date()): Record<string, string> {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'longOffset'
  });
  return {
    localDateTime: formatter.format(now),
    timeZone,
    utcTime: now.toISOString()
  };
}

export async function searchWeb(
  query: string,
  maxResults: number = DEFAULT_SEARCH_RESULTS,
  networkFetch: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
  signal?: AbortSignal
): Promise<SearchResponse> {
  const normalizedQuery = query.trim().slice(0, 160);
  if (normalizedQuery.length < 2) throw new Error('搜索关键词至少需要 2 个字符。');
  signal?.throwIfAborted();
  const resultLimit = Math.min(8, Math.max(1, Math.round(maxResults)));
  const cacheKey = JSON.stringify([normalizedQuery, resultLimit]);
  let cache = searchCaches.get(networkFetch);
  if (!cache) {
    cache = new Map();
    searchCaches.set(networkFetch, cache);
  }
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return { ...structuredClone(cached.value), cacheHit: true };
  cache.delete(cacheKey);

  const response = await networkFetch(
    `${DUCKDUCKGO_HTML_SEARCH_URL}?q=${encodeURIComponent(normalizedQuery)}`,
    {
      headers: { Accept: 'text/html,application/xhtml+xml' },
      signal
    }
  );
  if (!response.ok) throw new Error(`联网搜索失败 (${response.status})`);

  const html = await response.text();
  const results = parseDuckDuckGoResults(html).slice(0, resultLimit);
  if (results.length === 0) throw new Error('联网搜索没有返回可用结果。');
  const enrichedResults = await Promise.all(
    results.map(async (result, index) => {
      if (index >= 2) return result;
      const pageController = new AbortController();
      const pageSignal = signal ? AbortSignal.any([signal, pageController.signal]) : pageController.signal;
      // Snippets remain usable when an optional source page is too slow.
      const timeout = setTimeout(() => pageController.abort(), 1500);
      try {
        const pageResponse = await networkFetch(result.url, {
          headers: { Accept: 'text/html,text/plain,application/xhtml+xml' },
          signal: pageSignal
        });
        if (!pageResponse.ok) return result;
        const content = extractPageText(await pageResponse.text()).slice(0, 1500);
        return content ? { ...result, content } : result;
      } catch {
        signal?.throwIfAborted();
        return result;
      } finally {
        clearTimeout(timeout);
      }
    })
  );
  signal?.throwIfAborted();
  const value = { query: normalizedQuery, results: enrichedResults, cacheHit: false };
  if (cache.size >= 16) cache.delete(cache.keys().next().value!);
  cache.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, value: structuredClone(value) });
  return value;
}

export function parseDuckDuckGoResults(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const pattern =
    /<a\b[^>]*class=["'][^"']*\bresult__a\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<a\b[^>]*class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const url = normalizeSearchResultUrl(match[1]);
    const title = decodeHtmlText(match[2]);
    const snippet = decodeHtmlText(match[3]);
    if (!url || !title || results.some((result) => result.url === url)) continue;
    results.push({ title, url, snippet });
  }
  return results;
}

export function extractPageText(html: string): string {
  const cleaned = html
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ');
  const main =
    cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    cleaned.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
    cleaned;
  return decodeHtmlText(main.replace(/<(nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, ' '));
}

function normalizeSearchResultUrl(rawHref: string): string {
  try {
    const decodedHref = decodeHtmlEntities(rawHref);
    const url = new URL(decodedHref, 'https://duckduckgo.com');
    const destination =
      url.hostname.endsWith('duckduckgo.com') && url.pathname === '/l/'
        ? url.searchParams.get('uddg')
        : url.toString();
    if (!destination) return '';
    const normalized = new URL(destination);
    return normalized.protocol === 'https:' || normalized.protocol === 'http:' ? normalized.toString() : '';
  } catch {
    return '';
  }
}

function decodeHtmlText(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"'
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => namedEntities[name.toLowerCase()] ?? match);
}
