import { ActivityLog } from '../../logging/ActivityLog.ts';
import { installNodeRuntimeLogging } from './activityLogApi.ts';
import { fetchMemory } from './memoryServiceClient.ts';
import { memoryServiceUrl } from './memoryServiceAddress.ts';
import { ChatTurnOrchestrator } from './ChatTurnOrchestrator.ts';
import { createLlmClientFactory } from './memoryService.ts';
import { createMainLlmDebugFiles } from './MainLlmDebugFiles.ts';
import type { RealtimeGatewayServer } from '../realtime/RealtimeGatewayServer.ts';
import { createServerLlmFetch } from './serverLlmFetch.ts';

/**
 * The server-side chat pipeline: one activity log, one turn orchestrator and the
 * mutable reference to the realtime gateway the orchestrator broadcasts on.
 *
 * The HTTP `/api/chat` endpoint and the WebSocket `chat.turn` feature must share
 * a single orchestrator, otherwise cancelling over the socket cannot reach the
 * turn that was accepted over HTTP.
 */
export interface ChatBackend {
  readonly activityLog: ActivityLog;
  readonly orchestrator: ChatTurnOrchestrator;
  /** Set by the realtime gateway once it is listening; read by the orchestrator. */
  readonly gatewayRef: { server: RealtimeGatewayServer | null };
}

export interface ChatBackendOptions {
  /** Install Node process-level logging hooks (disabled under Vitest). */
  installRuntimeLogging?: boolean;
  /** Writable root for the runtime session marker and LLM debug dumps. */
  dataRoot?: string;
}

export function createChatBackend(options: ChatBackendOptions = {}): ChatBackend {
  const activityLog = new ActivityLog(
    fetchMemory,
    Date.now,
    () => crypto.randomUUID(),
    () => memoryServiceUrl('/activity-logs')
  );
  if ((options.installRuntimeLogging ?? true) && !process.env.VITEST) {
    installNodeRuntimeLogging(activityLog, options.dataRoot);
  }
  const gatewayRef: { server: RealtimeGatewayServer | null } = { server: null };
  const networkFetch = createServerLlmFetch();
  const orchestrator = new ChatTurnOrchestrator({
    networkFetch,
    broadcast: (topic, payload) => gatewayRef.server?.broadcast(topic, payload),
    recordEvent: activityLog.record,
    // Diagnostics live under the writable root so an overwrite-install cannot take them.
    createLlm: createLlmClientFactory(networkFetch, createMainLlmDebugFiles(options.dataRoot))
  });
  return { activityLog, orchestrator, gatewayRef };
}
