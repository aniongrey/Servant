import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGlobalNetworkFetch } from './globalNetworkFetch';

describe('createGlobalNetworkFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps relative application requests direct', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await createGlobalNetworkFetch({ proxyEnabled: true })('/api/ollama/tags');

    expect(fetchMock).toHaveBeenCalledWith('/api/ollama/tags', undefined);
  });

  it('routes external requests through the global proxy endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await createGlobalNetworkFetch({ proxyEnabled: true })('https://api.example.test/v1/items', {
      headers: { Authorization: 'Bearer test' }
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit | undefined];
    expect(url).toBe('/api/network-proxy');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      url: 'https://api.example.test/v1/items',
      method: 'GET',
      headers: { authorization: 'Bearer test' },
      useProxy: true
    });
  });

  it('relays external requests without an upstream proxy when disabled', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await createGlobalNetworkFetch({ proxyEnabled: false })('https://api.example.test/v1/items');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit | undefined];
    expect(url).toBe('/api/network-proxy');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      url: 'https://api.example.test/v1/items',
      useProxy: false
    });
  });
});
