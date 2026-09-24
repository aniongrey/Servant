import { createServer } from 'node:http';
import { searchWeb } from '../../../ai/llm/LlmTools.ts';
import {
  createChatTurnFeature,
  createDesktopSyncFeature,
  createVoiceStreamFeature,
  createWebSearchFeature,
  RealtimeGatewayServer
} from '../realtime/RealtimeGatewayServer.ts';
import { CHAT_TURN_FEATURE } from '../realtime/ChatTurnContracts.ts';
import { ACTION_VOICE_TOPIC } from '../realtime/VoiceStreamProtocol.ts';
import { REALTIME_WEBSOCKET_PATH } from '../realtime/RealtimeProtocol.ts';
import type { ChatBackend } from './chatBackend.ts';
import type { MiddlewareHost } from './httpMiddleware.ts';
import { createServerWebSearchFetch } from './serverLlmFetch.ts';

/** Browser development gateway port; the packaged app attaches to the sidecar port only. */
export const DEFAULT_REALTIME_GATEWAY_PORT = 5174;
export const REALTIME_GATEWAY_HOST = '127.0.0.1';

export interface RealtimeGatewayOptions {
  /**
   * Extra fixed port listened on beside the host HTTP server. Vite dev and a
   * standalone server started from the repo use
   * {@link DEFAULT_REALTIME_GATEWAY_PORT} so a page opened on a LAN address still
   * reaches the gateway. Pass `null` to attach to the host server only.
   */
  dedicatedPort?: number | null;
}

/**
 * Mounts the WebSocket gateway carrying every named stream (chat.text,
 * action.voice, desktop.sync, chat.turn, web.search).
 *
 * The gateway always attaches to the host HTTP server, so the page origin —
 * loopback, LAN, or the packed Tauri webview hitting the sidecar port — reaches
 * the same broadcast fan-out. Hosting it beside the orchestrator (rather than in
 * Rust) keeps the events and their producers in one process.
 */
export function realtimeGatewayApi(backend: ChatBackend, options: RealtimeGatewayOptions = {}) {
  const dedicatedPort =
    options.dedicatedPort === undefined ? DEFAULT_REALTIME_GATEWAY_PORT : options.dedicatedPort;

  const configure = (server: MiddlewareHost) => {
    if (!server.httpServer) return;
    const webSearchFetch = createServerWebSearchFetch();
    const gateway = new RealtimeGatewayServer()
      .registerFeature('desktop.sync', createDesktopSyncFeature())
      .registerFeature(ACTION_VOICE_TOPIC, createVoiceStreamFeature())
      .registerFeature(CHAT_TURN_FEATURE, createChatTurnFeature(backend.orchestrator))
      .registerFeature(
        'web.search',
        createWebSearchFeature((query, maxResults, signal) =>
          searchWeb(query, maxResults, webSearchFetch, signal)
        )
      )
      .attach(server.httpServer);
    backend.gatewayRef.server = gateway;
    // Tool results broadcast by the desktop resolve pending scheduler turns.
    gateway.onBroadcast((topic, payload) => backend.orchestrator.handleBroadcast(topic, payload));

    if (dedicatedPort === null) return;

    const dedicatedServer = createServer((_request, response) => {
      response.statusCode = 404;
      response.end('Servant realtime gateway');
    });
    dedicatedServer.once('error', (error: NodeJS.ErrnoException) => {
      if (backend.gatewayRef.server === gateway) backend.gatewayRef.server = null;
      gateway.dispose();
      if (error.code === 'EADDRINUSE') {
        console.info(
          `[realtime] ${REALTIME_GATEWAY_HOST}:${dedicatedPort} is already served by another local gateway.`
        );
        return;
      }
      console.error('[realtime] Unable to start the local gateway:', error);
    });
    dedicatedServer.listen(dedicatedPort, REALTIME_GATEWAY_HOST, () => {
      console.info(
        `[realtime] WebSocket gateway listening on ws://${REALTIME_GATEWAY_HOST}:${dedicatedPort}${REALTIME_WEBSOCKET_PATH}`
      );
    });
    // `gateway.attach` already disposes the gateway when the host server closes;
    // this only drops the reference and releases the extra listening port.
    server.httpServer.once('close', () => {
      if (backend.gatewayRef.server === gateway) backend.gatewayRef.server = null;
      if (dedicatedServer.listening) dedicatedServer.close();
    });
  };

  return { name: 'realtime-push-gateway', configureServer: configure, configurePreviewServer: configure };
}
