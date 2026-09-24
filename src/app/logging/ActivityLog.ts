export type ActivityLogChannel = 'chat' | 'scheduler' | 'web-search' | 'memory' | 'runtime';
export type ActivityLogStatus = 'start' | 'success' | 'error' | 'info';

export interface ActivityLogEvent {
  id: string;
  at: number;
  day: string;
  channel: ActivityLogChannel;
  status: ActivityLogStatus;
  message: string;
  turnId?: string;
  details?: Record<string, unknown>;
}

export type ActivityLogInput = Omit<ActivityLogEvent, 'id' | 'at' | 'day'>;
export type ActivityLogRecorder = (event: ActivityLogInput) => void;

/**
 * Fallback target, only used when no resolver is injected. The server always
 * passes `memoryServiceUrl('/activity-logs')`, because the packaged sidecar picks
 * the memory service port at startup.
 */
const MEMORY_LOG_API = 'http://127.0.0.1:5175/api/memory/activity-logs';

/** Bound the replay buffer: an outage must not grow memory without limit. */
const MAX_BUFFERED_EVENTS = 200;
const RETRY_DELAY_MS = 1_500;
const MAX_RETRY_DELAY_MS = 30_000;

/**
 * Fire-and-forget activity log backed by the Python memory service.
 *
 * The log is written to before that service is guaranteed to be listening —
 * the very first event of a session (`installNodeRuntimeLogging`) is recorded
 * while the Python process is still importing — and it may be missing entirely
 * on a machine without the memory service installed. So an event is never
 * dropped on a connection failure: it is buffered and replayed with a growing
 * delay, and the outage is reported once instead of on every write.
 */
export class ActivityLog {
  private pending = new Set<Promise<void>>();
  private buffered: ActivityLogEvent[] = [];
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryDelay = RETRY_DELAY_MS;
  private offline = false;

  constructor(
    private readonly networkFetch: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = () => crypto.randomUUID(),
    /**
     * Resolved per call rather than at construction: the packaged sidecar picks
     * the memory service port at startup, after this log already exists.
     */
    private readonly resolveLogsUrl: () => string = () => MEMORY_LOG_API
  ) {}

  record: ActivityLogRecorder = (input) => {
    const at = this.now();
    this.send({ ...input, id: this.createId(), at, day: formatLocalDay(at) });
  };

  async list(day?: string): Promise<ActivityLogEvent[]> {
    const query = day ? `?day=${encodeURIComponent(day)}` : '';
    const value = (await this.request(`${this.resolveLogsUrl()}${query}`)) as {
      events?: ActivityLogEvent[];
    };
    return Array.isArray(value.events) ? value.events : [];
  }

  /** Accepted but not yet persisted events, i.e. what an outage is holding back. */
  get bufferedCount(): number {
    return this.buffered.length;
  }

  flush(): Promise<void[]> {
    return Promise.all([...this.pending]);
  }

  private send(event: ActivityLogEvent): void {
    const request = this.deliver(event).finally(() => this.pending.delete(request));
    this.pending.add(request);
  }

  private async deliver(event: ActivityLogEvent): Promise<void> {
    try {
      await this.request(this.resolveLogsUrl(), {
        method: 'POST',
        body: JSON.stringify({ event })
      });
      this.retryDelay = RETRY_DELAY_MS;
      if (this.offline) {
        this.offline = false;
        console.warn(`[activity-log] 记忆服务已恢复，正在补发暂存的 ${this.buffered.length} 条事件。`);
      }
    } catch (error) {
      this.buffer(event);
      if (!this.offline) {
        this.offline = true;
        console.warn(
          `[activity-log] 记忆服务不可用（${describeFailure(error)}），事件将暂存并在其就绪后补发。`
        );
      }
    }
  }

  private buffer(event: ActivityLogEvent): void {
    this.buffered.push(event);
    if (this.buffered.length > MAX_BUFFERED_EVENTS) this.buffered.shift();
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.replay();
    }, this.retryDelay);
    // Telemetry must never be the reason a process stays alive.
    (this.retryTimer as { unref?: () => void }).unref?.();
    // Back off only for the retries that follow, so the first attempt after an
    // outage is prompt and a long outage does not turn into a busy loop.
    this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_DELAY_MS);
  }

  /** Replays the oldest buffered event, rotating the queue so none starves. */
  private replay(): void {
    const event = this.buffered.shift();
    if (!event) return;
    this.send(event);
    if (this.buffered.length) this.scheduleRetry();
  }

  private async request(url: string, init?: RequestInit): Promise<unknown> {
    const response = await this.networkFetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'X-Servant-Memory': '1' }
    });
    if (!response.ok) throw new Error(`Memory log service failed (${response.status})`);
    return response.json();
  }
}

/** `ECONNREFUSED` alone is more useful than the whole undici cause chain. */
function describeFailure(error: unknown): string {
  const cause = (error as { cause?: unknown } | null | undefined)?.cause;
  const code = (cause as NodeJS.ErrnoException | undefined)?.code;
  if (code) return code;
  if (cause instanceof Error) return cause.message;
  return error instanceof Error ? error.message : String(error);
}

export function formatLocalDay(at: number): string {
  const date = new Date(at);
  const part = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`;
}
