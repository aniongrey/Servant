import { fetch as undiciFetch } from 'undici';
import { createServerFetchWithProxyFallback } from './ServerFetchWithProxyFallback.ts';
import { getGlobalHttpProxyAgent, globalHttpProxyUrl } from './networkProxyApi.ts';
import { OLLAMA_API_PREFIX, OLLAMA_BASE_URL } from './ollamaProxyApi.ts';
import { readOllamaStreamStart } from './OllamaStreamError.ts';

/**
 * Server-side search cannot use the browser's `/api/network-proxy` relay. Try the
 * machine connection first, then reuse the configured local proxy endpoint only
 * for transport failures. HTTP error responses stay visible to the caller.
 */
export function createServerWebSearchFetch(): typeof globalThis.fetch {
  return createServerFetchWithProxyFallback({
    directFetch: globalThis.fetch.bind(globalThis),
    proxyLabel: globalHttpProxyUrl(),
    proxyFetch: async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      return (await undiciFetch(url, {
        method: init?.method,
        headers: init?.headers as Record<string, string> | undefined,
        signal: init?.signal,
        dispatcher: getGlobalHttpProxyAgent(globalHttpProxyUrl())
      })) as unknown as Response;
    }
  });
}

/**
 * The LLM transport every server-side AI SDK client uses. `/api/ollama/*`
 * targets are rewritten to the machine's Ollama so clients can keep speaking in
 * page-relative URLs.
 */
export function createServerLlmFetch(): typeof globalThis.fetch {
  const externalFetch = createServerWebSearchFetch();
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    return url.startsWith(OLLAMA_API_PREFIX)
      ? fetchOllama(`${OLLAMA_BASE_URL}${url.slice(OLLAMA_API_PREFIX.length)}`, init)
      : externalFetch(input, init);
  }) as typeof globalThis.fetch;
}

async function fetchOllama(url: string, init?: RequestInit): Promise<Response> {
  const response = await globalThis.fetch(url, init);
  if (!response.body) return response;
  const reader = response.body.getReader();
  const streamStart = await readOllamaStreamStart(reader);
  const upstreamError = streamStart.error;
  if (upstreamError) {
    await reader.cancel();
    return new Response(JSON.stringify({ error: { message: upstreamError } }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }
  return new Response(
    new ReadableStream({
      async start(controller) {
        for (const chunk of streamStart.chunks) controller.enqueue(chunk);
        try {
          while (!streamStart.done) {
            const chunk = await reader.read();
            if (chunk.done) break;
            controller.enqueue(chunk.value);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
      cancel: () => reader.cancel()
    }),
    { status: response.status, statusText: response.statusText, headers: response.headers }
  );
}
