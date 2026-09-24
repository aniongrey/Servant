import { liveConfig, type LiveConfig } from '../config/live.config.ts';
import type { LiveEvent } from '../events/LiveEvent';
import { LiveEventNormalizer } from '../events/LiveEventNormalizer';
import type { LiveLogger } from '../logger/LiveLogger';
import { silentLiveLogger } from '../logger/LiveLogger';

export type BarrageGrabStatus = 'connected' | 'connecting' | 'disconnected';

export interface BarrageGrabSocket {
  onopen: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  close(): void;
}

export type BarrageGrabSocketFactory = (url: string) => BarrageGrabSocket;

export class BarrageGrabAdapter {
  private status: BarrageGrabStatus = 'disconnected';
  private socket?: BarrageGrabSocket;
  private reconnectDelayMs: number;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectEnabled = true;
  private readonly rawCallbacks = new Set<(rawEvent: unknown) => void>();
  private readonly eventCallbacks = new Set<(event: LiveEvent) => void>();

  constructor(
    private readonly normalizer = new LiveEventNormalizer(),
    private readonly config: LiveConfig = liveConfig,
    private readonly socketFactory: BarrageGrabSocketFactory = (url) => new WebSocket(url),
    private readonly logger: LiveLogger = silentLiveLogger
  ) {
    this.reconnectDelayMs = config.barrageGrab.reconnectDelayMs;
  }

  connect(): void {
    if (this.status === 'connected' || this.status === 'connecting') return;
    this.reconnectEnabled = true;
    this.status = 'connecting';
    this.clearReconnectTimer();

    try {
      const socket = this.socketFactory(this.config.barrageGrab.url);
      this.socket = socket;
      socket.onopen = () => {
        this.status = 'connected';
        this.reconnectDelayMs = this.config.barrageGrab.reconnectDelayMs;
      };
      socket.onmessage = (message) => this.handleMessage(message.data);
      socket.onerror = (error) => {
        this.logger.log('LIVE_ERROR', 'BarrageGrab socket error', error);
      };
      socket.onclose = () => {
        this.status = 'disconnected';
        this.socket = undefined;
        this.scheduleReconnect();
      };
    } catch (error) {
      this.status = 'disconnected';
      this.logger.log('LIVE_ERROR', 'Failed to connect BarrageGrab', error);
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.reconnectEnabled = false;
    this.clearReconnectTimer();
    this.status = 'disconnected';
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
  }

  onRawEvent(callback: (rawEvent: unknown) => void): () => void {
    this.rawCallbacks.add(callback);
    return () => this.rawCallbacks.delete(callback);
  }

  onEvent(callback: (event: LiveEvent) => void): () => void {
    this.eventCallbacks.add(callback);
    return () => this.eventCallbacks.delete(callback);
  }

  getStatus(): BarrageGrabStatus {
    return this.status;
  }

  private handleMessage(data: unknown): void {
    const rawEvent = parseSocketMessage(data);
    for (const callback of this.rawCallbacks) callback(rawEvent);
    const event = this.normalizer.normalize(rawEvent);
    if (!event) {
      this.logger.log('LIVE_RAW', 'Dropped unrecognized BarrageGrab payload', rawEvent);
      return;
    }
    for (const callback of this.eventCallbacks) callback(event);
  }

  private scheduleReconnect(): void {
    if (!this.reconnectEnabled || !this.config.barrageGrab.reconnect || this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
    this.reconnectDelayMs = Math.min(
      this.config.barrageGrab.maxReconnectDelayMs,
      Math.max(this.config.barrageGrab.reconnectDelayMs, this.reconnectDelayMs * 2)
    );
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }
}

function parseSocketMessage(data: unknown): unknown {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}
