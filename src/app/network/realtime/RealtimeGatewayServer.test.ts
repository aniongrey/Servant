import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
  createChatTurnFeature,
  createDesktopSyncFeature,
  createVoiceStreamFeature,
  createWebSearchFeature,
  RealtimeGatewayServer
} from './RealtimeGatewayServer';
import { REALTIME_PROTOCOL_VERSION, type RealtimeServerMessage } from './RealtimeProtocol';
import { ACTION_VOICE_TOPIC } from './VoiceStreamProtocol';
import { CHAT_TURN_FEATURE } from './ChatTurnContracts';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('RealtimeGatewayServer', () => {
  it('accepts a local page connecting across the 5173 and 5174 ports', async () => {
    const client = await createTestClient(undefined, 'http://localhost:5173');
    await expect(client.next((message) => message.type === 'ready')).resolves.toMatchObject({
      type: 'ready',
      version: REALTIME_PROTOCOL_VERSION
    });
  });

  it('returns a protocol error for unregistered features', async () => {
    const client = await createTestClient();
    client.socket.send(
      JSON.stringify({
        version: REALTIME_PROTOCOL_VERSION,
        type: 'command',
        id: 'unknown-1',
        feature: 'future.feature',
        action: 'run'
      })
    );

    await expect(client.next((message) => message.type === 'error')).resolves.toMatchObject({
      type: 'error',
      code: 'unknown_feature',
      requestId: 'unknown-1'
    });
  });

  it('runs web search and broadcasts one unified tool result', async () => {
    const search = vi.fn(async (query: string) => ({
      query,
      cacheHit: false,
      results: [
        {
          title: 'Official result',
          url: 'https://example.com/result',
          snippet: 'Processed search summary.'
        }
      ]
    }));
    const client = await createTestClient((gateway) =>
      gateway.registerFeature('web.search', createWebSearchFeature(search))
    );
    client.socket.send(
      JSON.stringify({
        version: REALTIME_PROTOCOL_VERSION,
        type: 'command',
        id: 'search-1',
        feature: 'web.search',
        action: 'run',
        payload: { jobId: 'websearch-1', query: 'latest official docs', maxResults: 5 }
      })
    );

    const pushed = await client.next(
      (message) =>
        message.type === 'event' &&
        message.topic === 'desktop.sync' &&
        (message.payload as { type?: string }).type === 'tool-result'
    );
    expect(search).toHaveBeenCalledWith('latest official docs', 5, expect.any(AbortSignal));
    expect(pushed).toMatchObject({
      type: 'event',
      topic: 'desktop.sync',
      payload: {
        type: 'tool-result',
        requestId: 'websearch-1',
        tool: 'web-search',
        success: true,
        speech: '',
        content: { query: 'latest official docs', results: [{ url: 'https://example.com/result' }] }
      }
    });
  });

  it('broadcasts character activity statuses to desktop clients', async () => {
    const client = await createTestClient((gateway) =>
      gateway.registerFeature('desktop.sync', createDesktopSyncFeature())
    );
    client.socket.send(
      desktopSyncCommand('status-1', {
        type: 'character-status',
        statuses: ['thinking', 'searching']
      })
    );

    await expect(
      client.next(
        (message) =>
          message.type === 'event' &&
          message.topic === 'desktop.sync' &&
          (message.payload as { type?: string }).type === 'character-status'
      )
    ).resolves.toMatchObject({
      payload: { type: 'character-status', statuses: ['thinking', 'searching'] }
    });
  });

  it('broadcasts a delivered reminder from the desktop scheduler', async () => {
    const client = await createTestClient((gateway) =>
      gateway.registerFeature('desktop.sync', createDesktopSyncFeature())
    );
    const payload = {
      type: 'reminder',
      jobId: 'reminder-1',
      message: '起来活动一下。',
      speech: '起来活动一下。',
      scheduledAt: 100,
      dueAt: 200
    };
    client.socket.send(desktopSyncCommand('reminder-sync-1', payload));

    await expect(
      client.next(
        (message) =>
          message.type === 'event' &&
          message.topic === 'desktop.sync' &&
          (message.payload as { type?: string }).type === 'reminder'
      )
    ).resolves.toMatchObject({ payload });
  });

  it('rejects voice events on desktop.sync and points them at action.voice', async () => {
    const client = await createTestClient((gateway) =>
      gateway.registerFeature('desktop.sync', createDesktopSyncFeature())
    );
    client.socket.send(
      desktopSyncCommand('voice-on-sync-1', { type: 'speech-start', id: 'reply-1', text: '你好。' })
    );

    await expect(
      client.next((message) => message.type === 'error' && message.requestId === 'voice-on-sync-1')
    ).resolves.toMatchObject({ code: 'invalid_payload', message: expect.stringContaining('action.voice') });
  });

  it('returns a desktop sync protocol error without terminating the gateway', async () => {
    const client = await createTestClient((gateway) =>
      gateway.registerFeature('desktop.sync', createDesktopSyncFeature())
    );
    client.socket.send(desktopSyncCommand('invalid-sync-1', { type: 'unknown' }));

    await expect(
      client.next((message) => message.type === 'error' && message.requestId === 'invalid-sync-1')
    ).resolves.toMatchObject({ code: 'invalid_payload' });

    client.socket.send(desktopSyncCommand('valid-sync-1', { type: 'character-settings-changed' }));
    await expect(
      client.next((message) => message.type === 'ack' && message.requestId === 'valid-sync-1')
    ).resolves.toMatchObject({ type: 'ack' });
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
  });

  it('broadcasts validated voice stream events to every client', async () => {
    const first = await createTestClient((gateway) =>
      gateway.registerFeature(ACTION_VOICE_TOPIC, createVoiceStreamFeature())
    );
    const second = await openClientSocket(`ws://127.0.0.1:${first.port}/api/realtime/ws`);
    first.socket.send(
      voiceCommand('voice-1', {
        type: 'reply-stream-start',
        id: 'reply-1',
        source: 'conversation',
        segment: {
          text: '先说。',
          spokenText: '先说。',
          emotion: 'happy',
          intensity: 0.7,
          shortAction: 'stunned'
        }
      })
    );

    const expectedPayload = {
      type: 'reply-stream-start',
      id: 'reply-1',
      source: 'conversation',
      segment: {
        text: '先说。',
        spokenText: '先说。',
        emotion: 'happy',
        intensity: 0.7,
        shortAction: 'stunned'
      }
    };
    await expect(
      first.next(
        (message) =>
          message.type === 'event' &&
          message.topic === ACTION_VOICE_TOPIC &&
          (message.payload as { type?: string }).type === 'reply-stream-start'
      )
    ).resolves.toMatchObject({ topic: ACTION_VOICE_TOPIC, payload: expectedPayload });
    await expect(
      second.next(
        (message) =>
          message.type === 'event' &&
          message.topic === ACTION_VOICE_TOPIC &&
          (message.payload as { type?: string }).type === 'reply-stream-start'
      )
    ).resolves.toMatchObject({ topic: ACTION_VOICE_TOPIC, payload: expectedPayload });
  });

  it.each([
    {
      type: 'reply-stream-segment',
      id: 'stream-1',
      index: 1,
      source: 'conversation',
      segment: {
        text: '后说。',
        spokenText: '后说。',
        emotion: 'curious',
        intensity: 0.5,
        shortAction: 'agree'
      }
    },
    {
      type: 'reply-stream-end',
      id: 'stream-1',
      segmentCount: 2,
      source: 'conversation'
    },
    {
      type: 'reply-sequence',
      id: 'stream-1',
      source: 'conversation',
      segments: [
        { text: '咦？', spokenText: '咦？', emotion: 'curious', intensity: 0.6, shortAction: 'stunned' },
        {
          text: '原来如此。',
          spokenText: '原来如此。',
          emotion: 'happy',
          intensity: 0.5,
          shortAction: 'agree'
        }
      ]
    },
    { type: 'speech-delta', id: 'reply-1', text: '第一句。第二', source: 'conversation' },
    { type: 'speech-cancel', id: 'reply-1', source: 'conversation' },
    { type: 'speech-playback-started', id: 'reply-1', source: 'conversation' },
    { type: 'speech-playback-completed', id: 'reply-1', source: 'conversation' }
  ])('broadcasts the action.voice event $type', async (payload) => {
    const client = await createTestClient((gateway) =>
      gateway.registerFeature(ACTION_VOICE_TOPIC, createVoiceStreamFeature())
    );
    client.socket.send(voiceCommand(`voice-${payload.type}`, payload));

    await expect(
      client.next(
        (message) =>
          message.type === 'event' &&
          message.topic === ACTION_VOICE_TOPIC &&
          (message.payload as { type?: string }).type === payload.type
      )
    ).resolves.toMatchObject({ payload });
  });

  it('rejects malformed voice stream events without broadcasting them', async () => {
    const client = await createTestClient((gateway) =>
      gateway.registerFeature(ACTION_VOICE_TOPIC, createVoiceStreamFeature())
    );
    client.socket.send(
      voiceCommand('voice-invalid-1', {
        type: 'reply-sequence',
        id: 'reply-1',
        source: 'conversation',
        segments: []
      })
    );

    await expect(
      client.next((message) => message.type === 'error' && message.requestId === 'voice-invalid-1')
    ).resolves.toMatchObject({ code: 'invalid_payload' });
  });

  it('lets the server broadcast stream events directly', async () => {
    const client = await createTestClient();
    client.gateway.broadcast('chat.text', { type: 'turn-error', turnId: 'turn-1', message: '失败' });

    await expect(
      client.next((message) => message.type === 'event' && message.topic === 'chat.text')
    ).resolves.toMatchObject({
      topic: 'chat.text',
      payload: { type: 'turn-error', turnId: 'turn-1', message: '失败' }
    });
  });

  it('notifies onBroadcast listeners for client-published events', async () => {
    const seen: Array<{ topic: string; payload: unknown }> = [];
    const client = await createTestClient((gateway) => {
      gateway.onBroadcast((topic, payload) => seen.push({ topic, payload }));
      return gateway.registerFeature(ACTION_VOICE_TOPIC, createVoiceStreamFeature());
    });
    client.socket.send(
      voiceCommand('voice-observed-1', { type: 'speech-cancel', id: 'reply-1', source: 'conversation' })
    );

    await expect(
      client.next((message) => message.type === 'ack' && message.requestId === 'voice-observed-1')
    ).resolves.toMatchObject({ type: 'ack' });
    expect(seen).toEqual([
      { topic: ACTION_VOICE_TOPIC, payload: { type: 'speech-cancel', id: 'reply-1', source: 'conversation' } }
    ]);
  });

  it('starts chat turns through the chat.turn feature and cancels them', async () => {
    const start = vi.fn(() => ({ turnId: 'turn-1' }));
    const cancel = vi.fn(() => true);
    const client = await createTestClient((gateway) =>
      gateway.registerFeature(CHAT_TURN_FEATURE, createChatTurnFeature({ start, cancel }))
    );

    client.socket.send(
      JSON.stringify({
        version: REALTIME_PROTOCOL_VERSION,
        type: 'command',
        id: 'turn-req-1',
        feature: CHAT_TURN_FEATURE,
        action: 'start',
        payload: minimalChatTurnRequest()
      })
    );
    await expect(
      client.next((message) => message.type === 'ack' && message.requestId === 'turn-req-1')
    ).resolves.toMatchObject({ payload: { turnId: 'turn-1' } });

    client.socket.send(
      JSON.stringify({
        version: REALTIME_PROTOCOL_VERSION,
        type: 'command',
        id: 'turn-req-2',
        feature: CHAT_TURN_FEATURE,
        action: 'cancel',
        payload: { turnId: 'turn-1' }
      })
    );
    await expect(
      client.next((message) => message.type === 'ack' && message.requestId === 'turn-req-2')
    ).resolves.toMatchObject({ payload: { cancelled: true } });
    expect(cancel).toHaveBeenCalledWith('turn-1');
  });

  it('rejects invalid chat turn payloads', async () => {
    const client = await createTestClient((gateway) =>
      gateway.registerFeature(CHAT_TURN_FEATURE, createChatTurnFeature({ start: vi.fn(), cancel: vi.fn() }))
    );
    client.socket.send(
      JSON.stringify({
        version: REALTIME_PROTOCOL_VERSION,
        type: 'command',
        id: 'turn-invalid-1',
        feature: CHAT_TURN_FEATURE,
        action: 'start',
        payload: { message: null }
      })
    );

    await expect(
      client.next((message) => message.type === 'error' && message.requestId === 'turn-invalid-1')
    ).resolves.toMatchObject({ code: 'invalid_payload' });
  });
});

function desktopSyncCommand(id: string, payload: unknown): string {
  return JSON.stringify({
    version: REALTIME_PROTOCOL_VERSION,
    type: 'command',
    id,
    feature: 'desktop.sync',
    action: 'publish',
    payload
  });
}

function voiceCommand(id: string, payload: unknown): string {
  return JSON.stringify({
    version: REALTIME_PROTOCOL_VERSION,
    type: 'command',
    id,
    feature: ACTION_VOICE_TOPIC,
    action: 'publish',
    payload
  });
}

function minimalChatTurnRequest(): Record<string, unknown> {
  return {
    message: { id: 'msg-1', role: 'user', text: '你好', createdAt: 1 },
    llmConfig: { provider: 'openai', baseUrl: 'https://example.com', model: 'gpt', apiKey: 'k' },
    personality: {
      id: 'p',
      displayName: 'Shiro',
      identity: '',
      traits: [],
      speakingStyle: [],
      boundaries: [],
      defaultEmotion: 'neutral'
    },
    personalityState: {
      mood: 'neutral',
      energy: 0.5,
      engagement: 0.5,
      lastInteractionAt: 0,
      recentTopics: [],
      frozen: false
    },
    soulContext: '',
    webSearchEnabled: false,
    ttsLanguage: 'zh'
  };
}

async function createTestClient(
  configure?: (gateway: RealtimeGatewayServer) => RealtimeGatewayServer,
  origin?: string
): Promise<{
  socket: WebSocket;
  gateway: RealtimeGatewayServer;
  port: number;
  messages: RealtimeServerMessage[];
  next(predicate: (message: RealtimeServerMessage) => boolean): Promise<RealtimeServerMessage>;
}> {
  const server = createServer();
  let gateway = new RealtimeGatewayServer();
  gateway = configure?.(gateway) ?? gateway;
  gateway.attach(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  cleanups.push(async () => {
    gateway.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const client = await openClientSocket(`ws://127.0.0.1:${address.port}/api/realtime/ws`, origin);
  return { ...client, gateway, port: address.port };
}

async function openClientSocket(
  url: string,
  origin?: string
): Promise<{
  socket: WebSocket;
  messages: RealtimeServerMessage[];
  next(predicate: (message: RealtimeServerMessage) => boolean): Promise<RealtimeServerMessage>;
}> {
  const socket = new WebSocket(url, { ...(origin ? { origin } : {}) });
  const messages: RealtimeServerMessage[] = [];
  const waiters: Array<{
    predicate(message: RealtimeServerMessage): boolean;
    resolve(message: RealtimeServerMessage): void;
  }> = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString()) as RealtimeServerMessage;
    messages.push(message);
    const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(message));
    if (waiterIndex >= 0) waiters.splice(waiterIndex, 1)[0].resolve(message);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  cleanups.push(async () => {
    socket.close();
  });
  return {
    socket,
    messages,
    next(predicate) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve) => waiters.push({ predicate, resolve }));
    }
  };
}
