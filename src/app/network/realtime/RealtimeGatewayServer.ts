import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import {
  isRecord,
  parseRealtimeCommand,
  REALTIME_PROTOCOL_VERSION,
  REALTIME_WEBSOCKET_PATH,
  type RealtimeCommandMessage,
  type RealtimeServerMessage
} from './RealtimeProtocol.ts';
import { validateVoiceStreamEvent, ACTION_VOICE_TOPIC } from './VoiceStreamProtocol.ts';
import {
  CHAT_TURN_FEATURE,
  validateChatTurnRequest,
  type ChatTurnRequest
} from './ChatTurnContracts.ts';
import { searchWeb, type SearchResponse } from '../../../ai/llm/LlmTools.ts';

const MAX_WEBSOCKET_PAYLOAD_BYTES = 64 * 1024;

export interface RealtimeFeatureContext {
  readonly connectionId: string;
  publish(topic: string, payload?: unknown): void;
  broadcast(topic: string, payload?: unknown): void;
}

export interface RealtimeFeature {
  handle(context: RealtimeFeatureContext, command: RealtimeCommandMessage): unknown | Promise<unknown>;
  disconnect?(connectionId: string): void;
  dispose?(): void;
}

export interface ChatTurnOrchestratorLike {
  start(request: ChatTurnRequest): { turnId: string };
  cancel(turnId?: string): boolean;
}

export class RealtimeProtocolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export class RealtimeGatewayServer {
  private readonly webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WEBSOCKET_PAYLOAD_BYTES
  });
  private readonly features = new Map<string, RealtimeFeature>();
  private readonly broadcastListeners = new Set<(topic: string, payload: unknown) => void>();
  private readonly attachedServers = new Set<HttpServer>();
  private disposed = false;

  constructor(private readonly path = REALTIME_WEBSOCKET_PATH) {
    this.webSocketServer.on('connection', (socket) => this.accept(socket));
  }

  registerFeature(name: string, feature: RealtimeFeature): this {
    if (this.features.has(name)) throw new Error(`Realtime feature already registered: ${name}`);
    this.features.set(name, feature);
    return this;
  }

  /**
   * Serves WebSocket upgrades on the given HTTP server. Attaching several
   * servers (e.g. the vite dev server plus the dedicated gateway port) keeps
   * every client — loopback, LAN and Tauri dev — on one broadcast fan-out.
   */
  attach(server: HttpServer): this {
    if (this.disposed) throw new Error('Realtime gateway is already disposed');
    if (this.attachedServers.has(server)) return this;
    this.attachedServers.add(server);
    server.on('upgrade', this.handleUpgrade);
    server.once('close', this.dispose);
    return this;
  }

  /** Server-side push onto a stream, delivered to every connected client. */
  broadcast(topic: string, payload?: unknown): void {
    this.emitOutbound(topic, payload);
  }

  /** Observe every broadcasted event, including ones relayed from client publishes. */
  onBroadcast(listener: (topic: string, payload: unknown) => void): () => void {
    this.broadcastListeners.add(listener);
    return () => this.broadcastListeners.delete(listener);
  }

  readonly dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    for (const server of this.attachedServers) {
      server.off('upgrade', this.handleUpgrade);
      server.off('close', this.dispose);
    }
    this.attachedServers.clear();
    for (const feature of this.features.values()) feature.dispose?.();
    for (const client of this.webSocketServer.clients) client.terminate();
    this.webSocketServer.close();
  };

  private readonly handleUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (readPathname(request.url) !== this.path) return;
    if (!isAllowedOrigin(request)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    this.webSocketServer.handleUpgrade(request, socket, head, (client) => {
      this.webSocketServer.emit('connection', client, request);
    });
  };

  private accept(socket: WebSocket): void {
    const connectionId = randomUUID();
    this.send(socket, { version: REALTIME_PROTOCOL_VERSION, type: 'ready', connectionId });

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        this.sendError(socket, 'unsupported_data', 'Binary messages are not supported');
        return;
      }
      const command = parseRealtimeCommand(data.toString());
      if (!command) {
        this.sendError(socket, 'invalid_message', 'Invalid realtime command');
        return;
      }
      const feature = this.features.get(command.feature);
      if (!feature) {
        this.sendError(socket, 'unknown_feature', `Unknown realtime feature: ${command.feature}`, command.id);
        return;
      }
      const context: RealtimeFeatureContext = {
        connectionId,
        publish: (topic, payload) =>
          this.send(socket, {
            version: REALTIME_PROTOCOL_VERSION,
            type: 'event',
            topic,
            payload
          }),
        broadcast: (topic, payload) => this.emitOutbound(topic, payload)
      };
      void Promise.resolve()
        .then(() => feature.handle(context, command))
        .then((payload) => {
          this.send(socket, {
            version: REALTIME_PROTOCOL_VERSION,
            type: 'ack',
            requestId: command.id,
            payload
          });
        })
        .catch((cause: unknown) => {
          const error =
            cause instanceof RealtimeProtocolError
              ? cause
              : new RealtimeProtocolError(
                  'feature_failed',
                  cause instanceof Error ? cause.message : 'Realtime feature failed'
                );
          this.sendError(socket, error.code, error.message, command.id);
        });
    });

    socket.once('close', () => {
      for (const feature of this.features.values()) feature.disconnect?.(connectionId);
    });
  }

  private emitOutbound(topic: string, payload?: unknown): void {
    for (const listener of this.broadcastListeners) listener(topic, payload);
    const message: RealtimeServerMessage = {
      version: REALTIME_PROTOCOL_VERSION,
      type: 'event',
      topic,
      payload
    };
    for (const client of this.webSocketServer.clients) this.send(client, message);
  }

  private send(socket: WebSocket, message: RealtimeServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  private sendError(socket: WebSocket, code: string, message: string, requestId?: string): void {
    this.send(socket, { version: REALTIME_PROTOCOL_VERSION, type: 'error', code, message, requestId });
  }
}

export function createWebSearchFeature(
  search: (query: string, maxResults: number, signal: AbortSignal) => Promise<SearchResponse> = (
    query,
    maxResults,
    signal
  ) => searchWeb(query, maxResults, globalThis.fetch.bind(globalThis), signal)
): RealtimeFeature {
  const jobs = new Map<string, Map<string, AbortController>>();
  const clearConnection = (connectionId: string) => {
    const connectionJobs = jobs.get(connectionId);
    if (!connectionJobs) return;
    for (const controller of connectionJobs.values()) controller.abort();
    jobs.delete(connectionId);
  };

  return {
    async handle(context, command) {
      if (command.action !== 'run') {
        throw new RealtimeProtocolError('unknown_action', `Unknown web.search action: ${command.action}`);
      }
      const payload = readWebSearchPayload(command.payload);
      let connectionJobs = jobs.get(context.connectionId);
      if (!connectionJobs) {
        connectionJobs = new Map();
        jobs.set(context.connectionId, connectionJobs);
      }
      connectionJobs.get(payload.jobId)?.abort();
      const controller = new AbortController();
      connectionJobs.set(payload.jobId, controller);
      try {
        const result = await search(payload.query, payload.maxResults, controller.signal);
        context.broadcast('desktop.sync', {
          type: 'tool-result',
          requestId: payload.jobId,
          tool: 'web-search',
          action: 'run',
          success: true,
          speech: '',
          content: { query: result.query, results: result.results }
        });
        return { jobId: payload.jobId, completed: true, resultCount: result.results.length };
      } catch (cause) {
        if (controller.signal.aborted) throw cause;
        const message = cause instanceof Error ? cause.message : '后台联网搜索失败。';
        context.broadcast('desktop.sync', {
          type: 'tool-result',
          requestId: payload.jobId,
          tool: 'web-search',
          action: 'run',
          success: false,
          speech: '联网查询失败了。',
          error: message
        });
        return { jobId: payload.jobId, completed: false, error: message };
      } finally {
        if (connectionJobs.get(payload.jobId) === controller) connectionJobs.delete(payload.jobId);
        if (connectionJobs.size === 0) jobs.delete(context.connectionId);
      }
    },
    disconnect: clearConnection,
    dispose() {
      for (const connectionId of jobs.keys()) clearConnection(connectionId);
    }
  };
}

export function createDesktopSyncFeature(): RealtimeFeature {
  return {
    handle(context, command) {
      if (command.action !== 'publish') {
        throw new RealtimeProtocolError('unknown_action', `Unknown desktop.sync action: ${command.action}`);
      }
      const event = readDesktopSyncEvent(command.payload);
      context.broadcast('desktop.sync', event);
      return { published: true, eventType: event.type };
    }
  };
}

/** Relays validated `action.voice` events (reply segments, speech playback) to every client. */
export function createVoiceStreamFeature(): RealtimeFeature {
  return {
    handle(context, command) {
      if (command.action !== 'publish') {
        throw new RealtimeProtocolError('unknown_action', `Unknown ${ACTION_VOICE_TOPIC} action: ${command.action}`);
      }
      let event;
      try {
        event = validateVoiceStreamEvent(command.payload);
      } catch (cause) {
        throw new RealtimeProtocolError(
          'invalid_payload',
          cause instanceof Error ? cause.message : 'invalid voice stream event'
        );
      }
      context.broadcast(ACTION_VOICE_TOPIC, event);
      return { published: true, eventType: event.type };
    }
  };
}

export function createChatTurnFeature(orchestrator: ChatTurnOrchestratorLike): RealtimeFeature {
  return {
    handle(_context, command) {
      if (command.action === 'start') {
        let request: ChatTurnRequest;
        try {
          request = validateChatTurnRequest(command.payload);
        } catch (cause) {
          throw new RealtimeProtocolError(
            'invalid_payload',
            cause instanceof Error ? cause.message : 'invalid chat turn request'
          );
        }
        return orchestrator.start(request);
      }
      if (command.action === 'cancel') {
        const turnId = isRecord(command.payload) ? command.payload.turnId : undefined;
        if (turnId !== undefined && typeof turnId !== 'string') {
          throw new RealtimeProtocolError('invalid_payload', 'turnId must be a string');
        }
        return { cancelled: orchestrator.cancel(turnId) };
      }
      throw new RealtimeProtocolError('unknown_action', `Unknown ${CHAT_TURN_FEATURE} action: ${command.action}`);
    }
  };
}

function readDesktopSyncEvent(value: unknown): Record<string, unknown> & { type: string } {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new RealtimeProtocolError('invalid_payload', 'desktop sync event type is required');
  }
  if (
    value.type.startsWith('reply-') ||
    value.type === 'speech-start' ||
    value.type === 'speech-delta' ||
    value.type === 'speech-end' ||
    value.type === 'speech-cancel' ||
    value.type === 'speech-playback-started' ||
    value.type === 'speech-playback-completed'
  ) {
    throw new RealtimeProtocolError(
      'invalid_payload',
      'voice stream events must be published on the action.voice stream'
    );
  }
  if (value.type === 'character-settings-changed') {
    return { type: value.type };
  }
  if (
    value.type === 'character-status' &&
    Array.isArray(value.statuses) &&
    value.statuses.length <= 4 &&
    value.statuses.every(
      (status) =>
        status === 'listening' || status === 'thinking' || status === 'typing' || status === 'searching'
    )
  ) {
    return { type: value.type, statuses: [...new Set(value.statuses)] };
  }
  if (value.type === 'reminder') {
    return readReminderSyncEvent(value);
  }
  if (value.type === 'reminder-started' || value.type === 'reminder-completed') {
    return { type: value.type, jobId: readJobId(value) };
  }
  if (value.type === 'scheduler-command') return readSchedulerCommandEvent(value);
  if (value.type === 'tool-result') return readToolResultEvent(value);
  throw new RealtimeProtocolError('invalid_payload', `Unknown desktop sync event: ${value.type}`);
}

function readSchedulerCommandEvent(
  value: Record<string, unknown>
): Record<string, unknown> & { type: string } {
  if (
    typeof value.requestId !== 'string' ||
    value.requestId.length === 0 ||
    value.requestId.length > 128 ||
    !isRecord(value.input) ||
    !['add', 'update', 'remove', 'list'].includes(String(value.input.action)) ||
    JSON.stringify(value.input).length > 4_000
  ) {
    throw new RealtimeProtocolError('invalid_payload', 'invalid scheduler-command event');
  }
  return { type: value.type as string, requestId: value.requestId, input: value.input };
}

function readToolResultEvent(value: Record<string, unknown>): Record<string, unknown> & { type: string } {
  if (
    typeof value.requestId !== 'string' ||
    value.requestId.length === 0 ||
    value.requestId.length > 128 ||
    (value.tool !== 'scheduler' && value.tool !== 'web-search') ||
    typeof value.action !== 'string' ||
    typeof value.success !== 'boolean' ||
    typeof value.speech !== 'string' ||
    value.speech.length > 200 ||
    (value.error !== undefined && (typeof value.error !== 'string' || value.error.length > 500)) ||
    (value.content !== undefined && JSON.stringify(value.content).length > 48_000)
  ) {
    throw new RealtimeProtocolError('invalid_payload', 'invalid tool-result event');
  }
  return {
    type: value.type as string,
    requestId: value.requestId,
    tool: value.tool,
    action: value.action,
    success: value.success,
    speech: value.speech,
    ...(value.content !== undefined ? { content: value.content } : {}),
    ...(typeof value.error === 'string' ? { error: value.error } : {})
  };
}

function readReminderSyncEvent(value: Record<string, unknown>): Record<string, unknown> & {
  type: string;
} {
  const type = typeof value.type === 'string' ? value.type : 'reminder';
  const jobId = readJobId(value);
  if (
    typeof value.message !== 'string' ||
    value.message.length > 500 ||
    typeof value.scheduledAt !== 'number' ||
    !Number.isFinite(value.scheduledAt) ||
    typeof value.dueAt !== 'number' ||
    !Number.isFinite(value.dueAt) ||
    value.dueAt < value.scheduledAt ||
    (value.speech !== undefined && (typeof value.speech !== 'string' || value.speech.length > 500)) ||
    (value.action !== undefined && (typeof value.action !== 'string' || value.action.length > 128)) ||
    (value.emotion !== undefined && (typeof value.emotion !== 'string' || value.emotion.length > 64)) ||
    (value.intensity !== undefined &&
      (typeof value.intensity !== 'number' ||
        !Number.isFinite(value.intensity) ||
        value.intensity < 0 ||
        value.intensity > 1))
  ) {
    throw new RealtimeProtocolError('invalid_payload', `invalid ${type} event`);
  }
  return {
    type,
    jobId,
    message: value.message,
    scheduledAt: value.scheduledAt,
    dueAt: value.dueAt,
    ...(typeof value.speech === 'string' ? { speech: value.speech } : {}),
    ...(typeof value.action === 'string' ? { action: value.action } : {}),
    ...(typeof value.emotion === 'string' ? { emotion: value.emotion } : {}),
    ...(typeof value.intensity === 'number' ? { intensity: value.intensity } : {}),
    ...(value.missed === true ? { missed: true } : {})
  };
}

function readWebSearchPayload(value: unknown): { jobId: string; query: string; maxResults: number } {
  const jobId = readJobId(value);
  const query = isRecord(value) && typeof value.query === 'string' ? value.query.trim().slice(0, 160) : '';
  const requestedLimit = isRecord(value) ? value.maxResults : undefined;
  if (query.length < 2)
    throw new RealtimeProtocolError('invalid_payload', 'query must contain at least 2 characters');
  if (
    requestedLimit !== undefined &&
    (typeof requestedLimit !== 'number' ||
      !Number.isFinite(requestedLimit) ||
      requestedLimit < 1 ||
      requestedLimit > 8)
  ) {
    throw new RealtimeProtocolError('invalid_payload', 'maxResults must be between 1 and 8');
  }
  return { jobId, query, maxResults: requestedLimit === undefined ? 5 : Math.round(requestedLimit) };
}

function readJobId(value: unknown): string {
  const jobId = isRecord(value) ? value.jobId : undefined;
  if (typeof jobId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(jobId)) {
    throw new RealtimeProtocolError('invalid_payload', 'jobId must be a non-empty identifier');
  }
  return jobId;
}

function readPathname(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined;
  try {
    return new URL(rawUrl, 'http://localhost').pathname;
  } catch {
    return undefined;
  }
}

function isAllowedOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return true;
  // The packed Tauri webview is served from a custom origin while the gateway
  // listens on a loopback port, so same-host comparison can never match there.
  if (isTauriOrigin(origin)) return true;
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(`http://${host}`);
    if (originUrl.host === requestUrl.host) return true;
    return isLoopbackHostname(originUrl.hostname) && isLoopbackHostname(requestUrl.hostname);
  } catch {
    return false;
  }
}

function isTauriOrigin(origin: string): boolean {
  return (
    origin === 'http://tauri.localhost' ||
    origin === 'https://tauri.localhost' ||
    origin === 'tauri://localhost'
  );
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}
