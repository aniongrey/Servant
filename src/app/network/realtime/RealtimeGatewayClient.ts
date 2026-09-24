import {
  parseRealtimeServerMessage,
  REALTIME_PROTOCOL_VERSION,
  REALTIME_WEBSOCKET_PATH,
  type RealtimeServerMessage
} from './RealtimeProtocol.ts';
import { ensureApiBase, resolveApiWebSocketUrl } from '../apiBase.ts';

const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 10_000;

type TopicListener = (payload: unknown) => void;
export type RealtimeConnectionState = 'disconnected' | 'connecting' | 'connected';

export class RealtimeGatewayClient {
  private socket?: WebSocket;
  private reconnectTimer?: number;
  private reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
  private shouldReconnect = false;
  private state: RealtimeConnectionState = 'disconnected';
  private candidates: string[] = [];
  private candidateIndex = 0;
  private sawReady = false;
  private readonly topicListeners = new Map<string, Set<TopicListener>>();
  private readonly readyListeners = new Set<() => void>();
  private readonly messageListeners = new Set<(message: RealtimeServerMessage) => void>();
  private readonly stateListeners = new Set<(state: RealtimeConnectionState) => void>();

  constructor() {}

  connect(): void {
    this.shouldReconnect = true;
    if (this.state === 'connecting') return;
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    )
      return;
    void this.open();
  }

  isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  getState(): RealtimeConnectionState {
    return this.state;
  }

  onReady(listener: () => void): () => void {
    this.readyListeners.add(listener);
    return () => this.readyListeners.delete(listener);
  }

  onMessage(listener: (message: RealtimeServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStateChange(listener: (state: RealtimeConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  on(topic: string, listener: TopicListener): () => void {
    const listeners = this.topicListeners.get(topic) ?? new Set<TopicListener>();
    listeners.add(listener);
    this.topicListeners.set(topic, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.topicListeners.delete(topic);
    };
  }

  sendCommand(feature: string, action: string, payload?: unknown, id = createRequestId()): boolean {
    if (!this.isOpen()) return false;
    this.socket!.send(
      JSON.stringify({
        version: REALTIME_PROTOCOL_VERSION,
        type: 'command',
        id,
        feature,
        action,
        payload
      })
    );
    return true;
  }

  close(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer !== undefined) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.socket?.close(1000, 'Client disposed');
    this.socket = undefined;
    this.candidates = [];
    this.candidateIndex = 0;
    this.setState('disconnected');
  }

  private async open(): Promise<void> {
    this.setState('connecting');
    if (this.candidates.length === 0) {
      try {
        this.candidates = await resolveRealtimeWebSocketUrls();
      } catch {
        this.setState('disconnected');
        if (this.shouldReconnect) this.scheduleReconnect();
        return;
      }
    }
    if (!this.shouldReconnect) return;
    const url = this.candidates[this.candidateIndex % this.candidates.length]!;
    const socket = new WebSocket(url);
    this.socket = socket;
    this.sawReady = false;
    socket.onmessage = (event) => {
      const message = parseRealtimeServerMessage(String(event.data));
      if (!message) return;
      for (const listener of this.messageListeners) listener(message);
      if (message.type === 'ready') {
        this.sawReady = true;
        this.reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
        this.setState('connected');
        for (const listener of this.readyListeners) listener();
      } else if (message.type === 'event') {
        for (const listener of this.topicListeners.get(message.topic) ?? []) listener(message.payload);
      }
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.setState('disconnected');
      // A socket that never became ready moves the rotation to the next
      // candidate gateway URL; an established connection just reconnects.
      if (!this.sawReady) this.candidateIndex = (this.candidateIndex + 1) % this.candidates.length;
      if (this.shouldReconnect) this.scheduleReconnect();
    };
    socket.onerror = () => socket.close();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== undefined) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.shouldReconnect) void this.open();
    }, this.reconnectDelayMs);
    this.reconnectDelayMs = Math.min(MAX_RECONNECT_DELAY_MS, this.reconnectDelayMs * 2);
  }

  private setState(state: RealtimeConnectionState): void {
    if (state === this.state) return;
    this.state = state;
    for (const listener of this.stateListeners) listener(state);
  }
}

export function buildRealtimeWebSocketUrl(href?: string, localPort = 5174): string {
  const currentHref = href ?? (typeof window === 'undefined' ? undefined : window.location.href);
  const currentUrl = currentHref ? new URL(currentHref) : undefined;
  const isLoopbackPage =
    currentUrl !== undefined &&
    (currentUrl.hostname === 'localhost' ||
      currentUrl.hostname === '127.0.0.1' ||
      currentUrl.hostname === '[::1]');
  const usesCurrentOrigin =
    currentUrl !== undefined &&
    (currentUrl.protocol === 'http:' || currentUrl.protocol === 'https:') &&
    currentUrl.hostname !== 'tauri.localhost' &&
    !isLoopbackPage;
  const gatewayOrigin = usesCurrentOrigin ? currentUrl.origin : `http://127.0.0.1:${localPort}`;
  const url = new URL(REALTIME_WEBSOCKET_PATH, gatewayOrigin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

/**
 * Gateway URLs to try in order: the packaged backend when there is one, then
 * the page origin (vite dev, preview and hosted deployments all serve the
 * gateway on their own HTTP server, so loopback, LAN and Tauri dev webviews
 * reach it), then the packaged Tauri gateway port, then the dedicated local
 * gateway port.
 */
export function buildRealtimeWebSocketUrlCandidates(
  href?: string,
  localPort = 5174,
  gatewayPort?: number,
  backendWebSocketUrl?: string
): string[] {
  const currentHref = href ?? (typeof window === 'undefined' ? undefined : window.location.href);
  const currentUrl = currentHref ? safeParseUrl(currentHref) : undefined;
  const isHttpPage =
    currentUrl !== undefined &&
    (currentUrl.protocol === 'http:' || currentUrl.protocol === 'https:') &&
    currentUrl.hostname !== 'tauri.localhost';
  const candidates: string[] = [];
  // The packaged backend owns every realtime feature — chat turns, voice,
  // desktop sync and web search. Its URL is absolute, so it wins over the
  // page-relative candidate that would resolve against `tauri.localhost`.
  if (backendWebSocketUrl) candidates.push(backendWebSocketUrl);
  if (currentUrl && isHttpPage) {
    const url = new URL(REALTIME_WEBSOCKET_PATH, currentUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    candidates.push(url.toString());
  }
  if (gatewayPort) candidates.push(`ws://127.0.0.1:${gatewayPort}${REALTIME_WEBSOCKET_PATH}`);
  candidates.push(`ws://127.0.0.1:${localPort}${REALTIME_WEBSOCKET_PATH}`);
  return [...new Set(candidates)];
}

async function resolveRealtimeWebSocketUrls(): Promise<string[]> {
  // The base has to be known before the socket URL can be built, and the
  // handshake may still be in flight on the first connect.
  await ensureApiBase().catch(() => undefined);
  const backendUrl = resolveApiWebSocketUrl(REALTIME_WEBSOCKET_PATH);
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const port = await invoke<number>('realtime_gateway_port');
      return buildRealtimeWebSocketUrlCandidates(window.location.href, 5174, port, backendUrl);
    } catch {
      return buildRealtimeWebSocketUrlCandidates(window.location.href, 5174, undefined, backendUrl);
    }
  }
  return buildRealtimeWebSocketUrlCandidates(
    typeof window === 'undefined' ? undefined : window.location.href,
    5174,
    undefined,
    backendUrl
  );
}

function safeParseUrl(href: string): URL | undefined {
  try {
    return new URL(href);
  } catch {
    return undefined;
  }
}

function createRequestId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
