export const REALTIME_PROTOCOL_VERSION = 1 as const;
export const REALTIME_WEBSOCKET_PATH = '/api/realtime/ws';

export interface RealtimeCommandMessage {
  version: typeof REALTIME_PROTOCOL_VERSION;
  type: 'command';
  id: string;
  feature: string;
  action: string;
  payload?: unknown;
}

export type RealtimeServerMessage =
  | {
      version: typeof REALTIME_PROTOCOL_VERSION;
      type: 'ready';
      connectionId: string;
    }
  | {
      version: typeof REALTIME_PROTOCOL_VERSION;
      type: 'ack';
      requestId: string;
      payload?: unknown;
    }
  | {
      version: typeof REALTIME_PROTOCOL_VERSION;
      type: 'event';
      topic: string;
      payload?: unknown;
    }
  | {
      version: typeof REALTIME_PROTOCOL_VERSION;
      type: 'error';
      code: string;
      message: string;
      requestId?: string;
    };

export function parseRealtimeCommand(raw: string): RealtimeCommandMessage | undefined {
  try {
    const value = JSON.parse(raw) as unknown;
    if (
      !isRecord(value) ||
      value.version !== REALTIME_PROTOCOL_VERSION ||
      value.type !== 'command' ||
      !isIdentifier(value.id) ||
      !isRoutePart(value.feature) ||
      !isRoutePart(value.action)
    ) {
      return undefined;
    }
    return {
      version: REALTIME_PROTOCOL_VERSION,
      type: 'command',
      id: value.id,
      feature: value.feature,
      action: value.action,
      payload: value.payload
    };
  } catch {
    return undefined;
  }
}

export function parseRealtimeServerMessage(raw: string): RealtimeServerMessage | undefined {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || value.version !== REALTIME_PROTOCOL_VERSION || typeof value.type !== 'string') {
      return undefined;
    }
    if (value.type === 'ready' && typeof value.connectionId === 'string') {
      return { version: REALTIME_PROTOCOL_VERSION, type: 'ready', connectionId: value.connectionId };
    }
    if (value.type === 'ack' && typeof value.requestId === 'string') {
      return {
        version: REALTIME_PROTOCOL_VERSION,
        type: 'ack',
        requestId: value.requestId,
        payload: value.payload
      };
    }
    if (value.type === 'event' && typeof value.topic === 'string') {
      return {
        version: REALTIME_PROTOCOL_VERSION,
        type: 'event',
        topic: value.topic,
        payload: value.payload
      };
    }
    if (value.type === 'error' && typeof value.code === 'string' && typeof value.message === 'string') {
      return {
        version: REALTIME_PROTOCOL_VERSION,
        type: 'error',
        code: value.code,
        message: value.message,
        requestId: typeof value.requestId === 'string' ? value.requestId : undefined
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function isRoutePart(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9_.-]{0,63}$/.test(value);
}
