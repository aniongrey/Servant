import { RealtimeGatewayClient } from './RealtimeGatewayClient.ts';
import { isRecord } from './RealtimeProtocol.ts';
import { publishRealtimeCommand } from './RealtimeBroadcastPublisher.ts';
import type { SchedulerCommandEvent, ToolResultEvent } from '../../../scheduler/SchedulerTypes.ts';
import type { CharacterActivityStatus } from '../../../character/interaction/CharacterInteractionController.ts';

/**
 * `desktop.sync` stream: system-level synchronization between pages
 * (character status, reminders, scheduler commands and tool results).
 * Conversation text travels on `chat.text` and reply voice/action playback
 * on `action.voice` — see VoiceStreamProtocol.
 */

export type DesktopRealtimeSyncEvent =
  | { type: 'character-settings-changed' }
  | { type: 'character-status'; statuses: CharacterActivityStatus[] }
  | {
      type: 'reminder';
      jobId: string;
      message: string;
      speech?: string;
      action?: string;
      emotion?: string;
      intensity?: number;
      missed?: boolean;
      scheduledAt: number;
      dueAt: number;
    }
  | { type: 'reminder-started' | 'reminder-completed'; jobId: string }
  | SchedulerCommandEvent
  | ToolResultEvent;

export function publishDesktopRealtimeSync(
  event: DesktopRealtimeSyncEvent,
  connectedClient?: RealtimeGatewayClient
): void {
  if (connectedClient?.sendCommand('desktop.sync', 'publish', event)) return;
  publishRealtimeCommand('desktop.sync', 'publish', event);
}

export function listenDesktopRealtimeSync(
  handler: (event: DesktopRealtimeSyncEvent) => void,
  onReady?: () => void
): () => void {
  const client = new RealtimeGatewayClient();
  const offReady = onReady ? client.onReady(onReady) : () => undefined;
  const offEvent = client.on('desktop.sync', (payload) => {
    const event = parseDesktopRealtimeSyncEvent(payload);
    if (event) handler(event);
  });
  client.connect();
  return () => {
    offReady();
    offEvent();
    client.close();
  };
}

export function parseDesktopRealtimeSyncEvent(value: unknown): DesktopRealtimeSyncEvent | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === 'character-settings-changed') return { type: value.type };
  if (
    value.type === 'character-status' &&
    Array.isArray(value.statuses) &&
    value.statuses.every(
      (status) =>
        status === 'listening' || status === 'thinking' || status === 'typing' || status === 'searching'
    )
  ) {
    return { type: value.type, statuses: [...new Set(value.statuses)] as CharacterActivityStatus[] };
  }
  if (
    value.type === 'reminder' &&
    typeof value.jobId === 'string' &&
    typeof value.message === 'string' &&
    typeof value.scheduledAt === 'number' &&
    typeof value.dueAt === 'number'
  ) {
    return {
      type: value.type,
      jobId: value.jobId,
      message: value.message,
      ...(typeof value.speech === 'string' ? { speech: value.speech } : {}),
      ...(typeof value.action === 'string' ? { action: value.action } : {}),
      ...(typeof value.emotion === 'string' ? { emotion: value.emotion } : {}),
      ...(typeof value.intensity === 'number' ? { intensity: value.intensity } : {}),
      ...(value.missed === true ? { missed: true } : {}),
      scheduledAt: value.scheduledAt,
      dueAt: value.dueAt
    };
  }
  if (
    (value.type === 'reminder-started' || value.type === 'reminder-completed') &&
    typeof value.jobId === 'string'
  ) {
    return { type: value.type, jobId: value.jobId };
  }
  if (
    value.type === 'scheduler-command' &&
    typeof value.requestId === 'string' &&
    isRecord(value.input) &&
    ['add', 'update', 'remove', 'list'].includes(String(value.input.action))
  ) {
    return value as unknown as SchedulerCommandEvent;
  }
  if (
    value.type === 'tool-result' &&
    typeof value.requestId === 'string' &&
    (value.tool === 'scheduler' || value.tool === 'web-search') &&
    typeof value.action === 'string' &&
    typeof value.success === 'boolean' &&
    typeof value.speech === 'string'
  ) {
    return {
      type: value.type,
      requestId: value.requestId,
      tool: value.tool,
      action: value.action,
      success: value.success,
      speech: value.speech,
      ...(value.content !== undefined ? { content: value.content } : {}),
      ...(typeof value.error === 'string' ? { error: value.error } : {})
    };
  }
  return undefined;
}
