import path from 'node:path';
import type { ApiModule } from './httpMiddleware.ts';
import { resolveProjectPaths, type ProjectPaths } from './projectPaths.ts';
import { createChatBackend, type ChatBackend } from './chatBackend.ts';
import { createServerLlmFetch } from './serverLlmFetch.ts';
import { localCorsApi } from './localCorsApi.ts';
import { conversationApi } from './conversationApi.ts';
import { activityLogApi } from './activityLogApi.ts';
import {
  characterSkillApi,
  CHARACTER_SKILL_DIRECTORY,
  DEFAULT_CHARACTER_SKILL_FILE
} from '../characterSkillApi.ts';
import { desktopCharacterApi, DESKTOP_CHARACTER_DIRECTORY } from '../desktopCharacterApi.ts';
import { memoryServiceApi } from '../memoryServiceApi.ts';
import { actionConfigApi } from './actionConfigApi.ts';
import { vrmaSegmentsApi } from './vrmaSegmentsApi.ts';
import { fullBodyMotionConfigApi } from './fullBodyMotionConfigApi.ts';
import { vrmaFilesApi } from './vrmaFilesApi.ts';
import { ollamaProxyApi } from './ollamaProxyApi.ts';
import { networkProxyApi } from './networkProxyApi.ts';
import { webSearchSettingsApi } from './webSearchSettingsApi.ts';
import { provisioningApi } from './provisioningApi.ts';
import { microDynamicsConfigApi } from './microDynamicsConfigApi.ts';
import { realtimeGatewayApi } from './realtimeGatewayApi.ts';
import { doubaoTtsProxyApi } from './doubaoTtsProxyApi.ts';
import { gptSovitsApi } from './gptsovits/gptSovitsApi.ts';
import { apiNotFoundApi } from './apiNotFoundApi.ts';
import { PROVISIONING_API_PATH } from '../../provisioning/provisioningTypes.ts';

export interface ApiModuleOptions {
  paths?: ProjectPaths;
  /**
   * Extra fixed port for the realtime gateway beside the host server. `null`
   * attaches to the host server only, which is what the packaged sidecar wants.
   */
  dedicatedRealtimePort?: number | null;
  /** Pin the memory service port; omit to keep the environment/default value. */
  memoryServicePort?: number;
  /** Install Node process-level logging hooks. Off under tests and tooling. */
  installRuntimeLogging?: boolean;
}

export interface ApiModuleSet {
  readonly paths: ProjectPaths;
  readonly backend: ChatBackend;
  readonly modules: ApiModule[];
  /** Stops the managed Python memory service, if it was started. */
  stopMemoryService(): void;
}

/**
 * The one and only backend route table.
 *
 * Both the Vite dev/preview server (`vite.config.ts`) and the standalone
 * `servant-server` entry build their backend from this function, which is what
 * keeps development and the packaged app from drifting apart. Adding an endpoint
 * here makes it available in both.
 */
export function createApiModules(options: ApiModuleOptions = {}): ApiModuleSet {
  const paths = options.paths ?? resolveProjectPaths();
  const backend = createChatBackend({
    installRuntimeLogging: options.installRuntimeLogging,
    dataRoot: paths.data
  });
  const memoryService = memoryServiceApi(paths, { port: options.memoryServicePort });

  const modules: ApiModule[] = [
    // First: grants the packed Tauri webview cross-origin access to every route.
    localCorsApi(),
    activityLogApi(backend.activityLog),
    conversationApi({
      orchestrator: backend.orchestrator,
      networkFetch: createServerLlmFetch(),
      recordEvent: backend.activityLog.record
    }),
    memoryService,
    characterSkillApi(
      path.resolve(paths.data, CHARACTER_SKILL_DIRECTORY),
      path.resolve(paths.root, DEFAULT_CHARACTER_SKILL_FILE)
    ),
    desktopCharacterApi(path.resolve(paths.data, DESKTOP_CHARACTER_DIRECTORY)),
    actionConfigApi(paths),
    vrmaSegmentsApi(paths),
    fullBodyMotionConfigApi(paths),
    vrmaFilesApi(paths),
    ollamaProxyApi(),
    networkProxyApi(),
    webSearchSettingsApi(paths),
    provisioningApi(paths),
    microDynamicsConfigApi(paths),
    realtimeGatewayApi(backend, { dedicatedPort: options.dedicatedRealtimePort }),
    doubaoTtsProxyApi(),
    gptSovitsApi(paths),
    // Last: turns an unmatched `/api/*` request into JSON 404 instead of HTML.
    apiNotFoundApi()
  ];

  return {
    paths,
    backend,
    modules,
    stopMemoryService: () => memoryService.stop()
  };
}

/** Every path prefix the backend owns. Used by the standalone server's 404 fallback. */
export const API_PATH_PREFIXES = [
  '/api/activity-logs',
  '/api/chat',
  '/api/memory',
  '/api/character-skill',
  '/api/desktop-character',
  '/api/action-configs',
  '/api/vrma-segments',
  '/api/vrma-files',
  '/api/full-body-motion-config',
  '/api/ollama',
  '/api/network-proxy',
  '/api/web-search-settings',
  PROVISIONING_API_PATH,
  '/api/micro-dynamics-config',
  '/api/realtime',
  '/api/doubao-tts',
  '/api/gpt-sovits'
] as const;
