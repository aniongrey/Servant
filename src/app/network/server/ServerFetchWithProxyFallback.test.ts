import { describe, expect, it, vi } from 'vitest';
import { createServerFetchWithProxyFallback } from './ServerFetchWithProxyFallback';

describe('createServerFetchWithProxyFallback', () => {
  it('retries a transport failure through the proxy', async () => {
    const directFetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const proxyResponse = new Response('ok');
    const proxyFetch = vi.fn(async () => proxyResponse);
    const fetch = createServerFetchWithProxyFallback({
      directFetch,
      proxyFetch,
      proxyLabel: 'local proxy'
    });

    await expect(fetch('https://example.com')).resolves.toBe(proxyResponse);
    expect(proxyFetch).toHaveBeenCalledOnce();
  });

  it('does not retry an HTTP error response', async () => {
    const response = new Response('rate limited', { status: 429 });
    const proxyFetch = vi.fn<typeof globalThis.fetch>();
    const fetch = createServerFetchWithProxyFallback({
      directFetch: vi.fn(async () => response),
      proxyFetch,
      proxyLabel: 'local proxy'
    });

    await expect(fetch('https://example.com')).resolves.toBe(response);
    expect(proxyFetch).not.toHaveBeenCalled();
  });

  it('does not retry a canceled request', async () => {
    const controller = new AbortController();
    controller.abort();
    const directError = new DOMException('Aborted', 'AbortError');
    const proxyFetch = vi.fn<typeof globalThis.fetch>();
    const fetch = createServerFetchWithProxyFallback({
      directFetch: vi.fn(async () => {
        throw directError;
      }),
      proxyFetch,
      proxyLabel: 'local proxy'
    });

    await expect(fetch('https://example.com', { signal: controller.signal })).rejects.toBe(directError);
    expect(proxyFetch).not.toHaveBeenCalled();
  });
});
