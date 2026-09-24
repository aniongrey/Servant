export interface ServerFetchWithProxyFallbackOptions {
  directFetch: typeof globalThis.fetch;
  proxyFetch: typeof globalThis.fetch;
  proxyLabel: string;
}

/**
 * Retries only transport failures. HTTP responses, including 4xx/5xx, are
 * returned unchanged so callers retain normal upstream error semantics.
 */
export function createServerFetchWithProxyFallback({
  directFetch,
  proxyFetch,
  proxyLabel
}: ServerFetchWithProxyFallbackOptions): typeof globalThis.fetch {
  return async (input, init) => {
    try {
      return await directFetch(input, init);
    } catch (directError) {
      if (init?.signal?.aborted) throw directError;
      try {
        return await proxyFetch(input, init);
      } catch (proxyError) {
        if (init?.signal?.aborted) throw proxyError;
        throw new AggregateError([directError, proxyError], `联网请求直连和代理 ${proxyLabel} 均失败`);
      }
    }
  };
}
