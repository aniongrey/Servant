import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchMemory,
  prewarmMemoryService,
  registerMemoryServiceLifecycle,
  waitForMemoryService
} from './memoryServiceClient.ts';

/**
 * The client exists because a request that arrives during the memory service's
 * ~13s warm-up used to be indistinguishable from one arriving at a service that
 * was never installed. These cases pin down the three answers it has to tell
 * apart — serving, still warming, and never coming back — plus the promise that
 * a cold start does not multiply the polling.
 */

const SEARCH = 'http://127.0.0.1:5175/api/memory/search';
const HEALTH = 'http://127.0.0.1:5175/api/memory/health';

let spawnError: Error | undefined;
let calls: string[];

/** Minimal stand-in: the client only reads `status`, `ok`, `clone`, `json`. */
function reply(status: number, body: unknown): Response {
  const response = {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    clone: () => response
  };
  return response as unknown as Response;
}

function route(rules: Array<[string, () => Response]>): void {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    const rule = rules.find(([prefix]) => url.startsWith(prefix));
    if (!rule) throw new Error(`unexpected request: ${url}`);
    return rule[1]();
  });
}

const sequence = (...responses: Array<() => Response>) => {
  let index = 0;
  // Invoke the chosen maker, so a rule can be handed straight to `route`.
  return () => responses[Math.min(index++, responses.length - 1)]();
};

beforeEach(() => {
  spawnError = undefined;
  calls = [];
  registerMemoryServiceLifecycle({ start: () => {}, spawnError: () => spawnError });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchMemory', () => {
  it('returns the response untouched when the service is ready', async () => {
    route([[SEARCH, () => reply(200, { memories: [] })]]);
    expect((await fetchMemory(SEARCH)).status).toBe(200);
    expect(calls).toEqual([SEARCH]);
  });

  it('waits out a warming service and answers 200 instead of the 503', async () => {
    route([
      [HEALTH, sequence(() => reply(200, { status: 'warming', seconds: 4 }), () => reply(200, { status: 'ready', seconds: 12 }))],
      [SEARCH, sequence(() => reply(503, { status: 'warming', error: '正在预热' }), () => reply(200, { memories: [] }))]
    ]);

    const response = await fetchMemory(SEARCH);

    expect(response.status).toBe(200);
    // One attempt, then the readiness poll, then exactly one retry.
    expect(calls).toEqual([SEARCH, HEALTH, HEALTH, SEARCH]);
  });

  it('fails fast with the spawn reason instead of waiting out the budget', async () => {
    spawnError = new Error('python 缺少 memory_service/requirements.txt 中的依赖');
    route([
      [HEALTH, () => reply(200, { status: 'warming', seconds: 1 })],
      [SEARCH, () => reply(503, { status: 'warming' })]
    ]);

    // A process that is gone will never become ready; the wait must not hide it.
    await expect(fetchMemory(SEARCH)).rejects.toThrow('requirements.txt');
    expect(calls).toEqual([SEARCH, HEALTH]);
  });

  it('lets a cancelled caller go instead of holding it open', async () => {
    let aborted = false;
    route([
      [HEALTH, () => reply(200, aborted ? { status: 'ready' } : { status: 'warming', seconds: 2 })],
      [SEARCH, sequence(() => reply(503, { status: 'warming' }))]
    ]);

    const controller = new AbortController();
    const pending = fetchMemory(SEARCH, { signal: controller.signal });
    controller.abort();
    aborted = true;

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('shares one readiness poll between concurrent callers', async () => {
    route([
      [
        HEALTH,
        sequence(
          () => reply(200, { status: 'warming', seconds: 2 }),
          () => reply(200, { status: 'warming', seconds: 4 }),
          () => reply(200, { status: 'ready', seconds: 12 })
        )
      ],
      // Both calls are refused once, then both succeed after the shared wait.
      [SEARCH, sequence(() => reply(503, { status: 'warming' }), () => reply(503, { status: 'warming' }), () => reply(200, { memories: [] }))]
    ]);

    const [first, second] = await Promise.all([fetchMemory(SEARCH), fetchMemory(SEARCH)]);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(calls.filter((url) => url === HEALTH)).toHaveLength(3);
  });
});

describe('waitForMemoryService', () => {
  it('resolves as failed when the service reports a warm-up failure', async () => {
    route([[HEALTH, () => reply(200, { status: 'failed', error: 'embedding dimension mismatch' })]]);
    expect(await waitForMemoryService()).toMatchObject({
      status: 'failed',
      error: 'embedding dimension mismatch'
    });
  });

  it('gives up after the budget rather than polling forever', async () => {
    route([[HEALTH, () => reply(200, { status: 'warming', seconds: 3 })]]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await waitForMemoryService({ timeoutMs: 10 })).toMatchObject({ status: 'warming' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('still warming'));
    warn.mockRestore();
  });
});

describe('prewarmMemoryService', () => {
  it('drives the warm-up with no request behind it and reports when it lands', async () => {
    route([
      [
        HEALTH,
        sequence(
          () => reply(200, { status: 'warming', seconds: 2 }),
          () => reply(200, { status: 'ready', seconds: 12 })
        )
      ]
    ]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    prewarmMemoryService();
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith(expect.stringContaining('ready in')));

    // Nothing but health probes: unlike every other path through this module,
    // the polling was not triggered by a caller asking for data.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((url) => url === HEALTH)).toBe(true);
    log.mockRestore();
  });

  it('does not start a second warm-up when startup runs it again', async () => {
    route([[HEALTH, () => reply(200, { status: 'ready' })]]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    calls = [];

    prewarmMemoryService();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // A server that calls configure twice must not double the log or the polls.
    expect(calls).toEqual([]);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
