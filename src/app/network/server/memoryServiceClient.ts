import { memoryServiceUrl } from './memoryServiceAddress.ts';

/**
 * The one client of the Python memory service, and the one place that knows
 * whether it can be used yet.
 *
 * On this machine the service needs ~13s before it can answer anything: ~1.4s
 * importing lancedb/pyarrow, ~9.9s importing sentence-transformers (which drags
 * in torch), and ~1.7s loading the embedding weights. It now binds its port
 * immediately and warms up in a background thread, answering 503 `warming` until
 * it is done.
 *
 * That window used to be nobody's responsibility, and three call paths each
 * guessed differently: `memoryGet`/`memoryPost` and the `/api/chat/history`
 * handler had no retry at all, while the retry `fetchMemory` did have was
 * 20 x 100ms — 2s, which cannot cover a 13s model load. So the first request
 * after launch either surfaced a 503 to the webview or degraded silently:
 *
 *   - `ChatContextBuilder` races its lookup against a 2.5s budget, so the first
 *     turn always lost both history and memory;
 *   - the abandoned lookup was still in flight when the turn ended, so its abort
 *     surfaced as `[chat] asynchronous persistence failed: This operation was
 *     aborted` — the log line that started this investigation;
 *   - `/api/memory/*` and `/api/chat/history` answered the webview with 503.
 *
 * Every caller now goes through {@link fetchMemory}, which waits for `ready`
 * instead of guessing. Nothing else had to change: warm latency is ~0.3s, so a
 * caller that waits a few seconds gets a real answer rather than a degradation.
 */

export type MemoryServiceStatus = 'ready' | 'warming' | 'failed' | 'unreachable' | 'aborted';

export interface MemoryServiceHealth {
  /** Only `ready` means a request will be served; the rest are all "not yet". */
  status: MemoryServiceStatus;
  /** Seconds spent warming up so far, as reported by the service itself. */
  seconds?: number;
  error?: string;
  model?: string;
}

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

/** Answered even while warming, so it doubles as the reachability probe. */
const HEALTH_PATH = '/health';
const HEALTH_TIMEOUT_MS = 2_000;
const READY_POLL_MS = 250;

/** Spawning is asynchronous: the port can refuse a connection for a moment. */
const CONNECT_ATTEMPTS = 20;
const CONNECT_DELAY_MS = 100;

/** How long one request may wait for the service to finish warming up. */
export const MEMORY_READY_TIMEOUT_MS = readPositiveInt('SHIRO_MEMORY_READY_TIMEOUT_MS', 30_000);

export interface MemoryServiceLifecycle {
  /** Start the process if it is not running. Idempotent. */
  start(): void;
  /** Why the process died, if it did — turns a long wait into a named failure. */
  spawnError(): Error | undefined;
}

let lifecycle: MemoryServiceLifecycle | undefined;
let readyWait: Promise<MemoryServiceHealth> | undefined;

/**
 * Lets the spawner hand over its two facts, so this module can decide between
 * waiting and giving up. One spawner per process, so one slot is enough.
 */
export function registerMemoryServiceLifecycle(next: MemoryServiceLifecycle): void {
  lifecycle = next;
}

/** Health as the service reports it, or `unreachable` if it cannot be asked. */
export async function readMemoryHealth(): Promise<MemoryServiceHealth> {
  try {
    const response = await fetch(memoryServiceUrl(HEALTH_PATH), {
      headers: { 'X-Shiro-Memory': '1' },
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
    });
    if (!response.ok) return { status: 'unreachable' };
    const body = (await response.json()) as Partial<MemoryServiceHealth>;
    return { status: body.status ?? 'unreachable', ...body } as MemoryServiceHealth;
  } catch {
    // Refused (not listening yet) or timed out: the warm-up thread holds the GIL
    // through parts of that import, so an early /health can be slow to answer.
    return { status: 'unreachable' };
  }
}

/**
 * Resolves once the service is ready, or once waiting can no longer help.
 *
 * Concurrent callers share one poll: a cold start wakes up a burst of requests
 * (history, activity log, the first turn) and they should not each ask.
 */
export function waitForMemoryService(
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<MemoryServiceHealth> {
  const pending = (readyWait ??= pollUntilReady(options.timeoutMs ?? MEMORY_READY_TIMEOUT_MS));
  const { signal } = options;
  if (!signal) return pending;
  if (signal.aborted) return Promise.resolve<MemoryServiceHealth>({ status: 'aborted' });
  // A cancelled chat turn must not be held open by a warm-up it has stopped
  // caring about; the shared poll keeps running for whoever needs it next.
  const race = abortResult(signal);
  return Promise.race([pending, race.promise]).finally(race.dispose);
}

let prewarmStarted = false;

/**
 * Drive the warm-up from startup, so the first request finds it already done.
 *
 * The Python process binds its port and starts loading the model the moment it
 * is spawned, so strictly speaking the warm-up already overlapped with startup
 * before this existed. What was missing is that *nothing watched it*: the
 * readiness poll only began when some request happened to arrive, and nothing
 * recorded when the service became usable. A cold start therefore showed up as
 * an unexplained stall on whichever request was unlucky enough to be first,
 * indistinguishable from a slow route.
 *
 * Calling this at startup starts the clock at process start and leaves one line
 * in the log either way. It is deliberately not awaited: blocking startup on a
 * 13s model load would make the whole app feel slower to open, which is the
 * opposite of the intent. Requests that arrive during the warm-up are not
 * penalised — {@link waitForMemoryService} shares one poll, so they await the
 * promise this started rather than racing against it.
 */
export function prewarmMemoryService(): void {
  if (prewarmStarted) return;
  prewarmStarted = true;
  const startedAt = Date.now();
  void waitForMemoryService().then((health) => {
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (health.status === 'ready') {
      console.log(`[memory] pre-warmed at startup — ready in ${seconds}s`);
      return;
    }
    // A named failure is the point of the exercise: "still warming" and "the
    // interpreter lacks its dependencies" must not look the same in the log.
    const detail = health.error ? ` — ${health.error}` : '';
    console.warn(`[memory] startup pre-warm did not finish (${seconds}s): ${health.status}${detail}`);
  });
}

async function pollUntilReady(timeoutMs: number): Promise<MemoryServiceHealth> {
  const deadline = Date.now() + timeoutMs;
  try {
    let health = await readMemoryHealth();
    while (health.status !== 'ready' && health.status !== 'failed') {
      const died = lifecycle?.spawnError();
      if (died) return { status: 'failed', error: died.message };
      if (Date.now() >= deadline) {
        console.warn(
          `[memory] still ${health.status} after ${Math.round(timeoutMs / 1000)}s; ` +
            'requests will answer without memory context'
        );
        return health;
      }
      await delay(READY_POLL_MS);
      health = await readMemoryHealth();
    }
    return health;
  } finally {
    readyWait = undefined;
  }
}

/**
 * Fetch against the memory service, tolerating both ends of a cold start: a port
 * that is not listening yet, and a service that answers 503 `warming`.
 *
 * Drop-in for `fetch`, so it can be handed to anything that wants a memory client
 * (`ActivityLog`, the chat orchestrator, the `/api/memory` proxy). Request bodies
 * must be replayable, since a warming answer is retried.
 */
export const fetchMemory: typeof fetch = async (input: FetchInput, init?: FetchInit) => {
  lifecycle?.start();
  const response = await fetchWithConnectRetry(input, init);
  if (response.status !== 503) return response;
  if (!(await isWarmingResponse(response))) return response;
  const health = await waitForMemoryService({ signal: init?.signal ?? undefined });
  if (health.status === 'ready') return fetchWithConnectRetry(input, init);
  // A failure never becomes ready, and its reason is worth surfacing verbatim.
  if (health.status === 'failed' && health.error) throw new Error(health.error);
  // The caller gave up before the service came up. Report it the way `fetch`
  // reports an abort, so a cancelled turn is not read as a broken service.
  if (health.status === 'aborted') throw abortErrorOf(init?.signal);
  // Still warming: hand back the 503 so the caller decides what it can do without.
  return response;
};

async function fetchWithConnectRetry(input: FetchInput, init?: FetchInit): Promise<Response> {
  let error: unknown;
  for (let attempt = 0; attempt < CONNECT_ATTEMPTS; attempt += 1) {
    try {
      return await fetch(input, init);
    } catch (cause) {
      error = cause;
      // Only a missing listener is retried. An aborted request propagates at
      // once — otherwise a cancelled turn would be kept alive by the retry.
      if (init?.signal?.aborted) break;
      await delay(CONNECT_DELAY_MS);
    }
  }
  throw error;
}

async function isWarmingResponse(response: Response): Promise<boolean> {
  try {
    const body = (await response.clone().json()) as { status?: unknown };
    return body.status === 'warming';
  } catch {
    return false;
  }
}

function abortResult(signal: AbortSignal): {
  promise: Promise<MemoryServiceHealth>;
  dispose: () => void;
} {
  let onAbort: (() => void) | undefined;
  const promise = new Promise<MemoryServiceHealth>((resolve) => {
    onAbort = () => resolve({ status: 'aborted' });
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return {
    promise,
    dispose: () => {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function abortErrorOf(signal?: AbortSignal | null): Error {
  const reason = signal?.reason;
  return reason instanceof Error ? reason : new DOMException('The operation was aborted.', 'AbortError');
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
