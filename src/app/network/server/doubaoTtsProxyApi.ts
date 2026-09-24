import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import type { MiddlewareHost } from './httpMiddleware.ts';

export const DOUBAO_TTS_WS_PATH = '/api/doubao-tts/ws';
const DOUBAO_TTS_UPSTREAM = 'wss://openspeech.bytedance.com/api/v3/tts/unidirectional/stream';
const DOUBAO_TTS_RESOURCE_IDS = ['seed-tts-2.0', 'seed-icl-2.0', 'seed-tts-1.0'];

/**
 * Relays the Doubao (Volcengine) TTS streaming socket. The API key travels in
 * the first client frame, so the webview never holds a signed upstream URL.
 */
export function doubaoTtsProxyApi() {
  const configure = (server: MiddlewareHost) => {
    server.httpServer?.on('upgrade', (request, socket, head) => {
      if (!request.url?.startsWith(DOUBAO_TTS_WS_PATH)) return;
      const clients = new WebSocketServer({ noServer: true });
      clients.handleUpgrade(request, socket, head, (client) => {
        const upstreamRef: { socket?: WebSocket } = {};
        let authorized = false;
        const pending: Array<{ data: unknown; binary: boolean }> = [];
        client.on('message', (data, isBinary) => {
          const upstream = upstreamRef.socket;
          if (!authorized) {
            if (!isBinary) {
              try {
                const init = JSON.parse(data.toString()) as { apiKey?: string; resourceId?: string };
                if (!init.apiKey) throw new Error('Missing API key');
                if (!DOUBAO_TTS_RESOURCE_IDS.includes(init.resourceId ?? '')) {
                  throw new Error('Invalid Doubao TTS resource id');
                }
                const socket = new WebSocket(DOUBAO_TTS_UPSTREAM, {
                  headers: {
                    'X-Api-Key': init.apiKey,
                    'X-Api-Resource-Id': init.resourceId!,
                    'X-Api-Connect-Id': randomUUID()
                  }
                });
                socket.binaryType = 'arraybuffer';
                upstreamRef.socket = socket;
                socket.on('open', () => {
                  authorized = true;
                  for (const item of pending) socket.send(item.data as never, { binary: item.binary });
                  pending.length = 0;
                });
                socket.on('message', (payload, binary) => {
                  if (client.readyState === WebSocket.OPEN) client.send(payload as never, { binary });
                });
                socket.on('error', () => client.close(1011, 'Doubao upstream failed'));
                socket.on('close', () => client.close());
              } catch {
                client.close(1008, 'Invalid Doubao TTS authorization');
              }
              return;
            }
            pending.push({ data, binary: isBinary });
            return;
          }
          if (upstream?.readyState === WebSocket.OPEN) upstream.send(data as never, { binary: isBinary });
        });
        client.on('close', () => upstreamRef.socket?.close());
      });
    });
  };
  return {
    name: 'doubao-tts-websocket-proxy',
    configureServer: configure,
    configurePreviewServer: configure
  };
}
