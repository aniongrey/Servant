import { createReadStream } from 'node:fs';
import path from 'node:path';
import type { MiddlewareHost } from './httpMiddleware.ts';
import { apiPathOf, isAllowedLocalOrigin, readRequestText, sendJson } from './httpMiddleware.ts';
import type { ProjectPaths } from './projectPaths.ts';
import { getResourceEntry, RESOURCE_MANIFEST, type ResourceManifestEntry } from './resourceManifest.ts';
import { resolveResourceAsset } from './provisioningAssets.ts';
import {
  defaultDownloadRoot,
  downloadRootOf,
  downloadRootProblem,
  readProvisioningStateSync,
  resourceRoots,
  writeProvisioningState
} from './provisioningStore.ts';
import { publishSharedModelRoot, readSharedModelRoots } from './sharedModelRoots.ts';
import { locateResource } from './resourcePresence.ts';
import { evaluateSetupGate } from './provisioningGate.ts';
import { downloadModelRepo, getModelSite, readModelRepoMarker, type RepoMarker } from './modelRepository.ts';
import {
  createDefaultProvisioningState,
  modelSiteLabel,
  normalizeModelSiteOrder,
  normalizeProvisioningState,
  PROVISIONING_API_PATH,
  PROVISIONING_STATE_FILE,
  type ModelSiteId,
  type ProvisioningState
} from '../../provisioning/provisioningTypes.ts';

/** Kept as a named export because the route table lists prefixes next to it. */
export const PROVISIONING_API = PROVISIONING_API_PATH;
export { PROVISIONING_STATE_FILE };

/**
 * `ready` means the repository was pulled to completion into the *download root*
 * (a marker file says so), never merely "the directory exists" and never "an
 * older copy happens to be around": a download that died halfway must not look
 * installable, and the panel's job is to bring the model under the directory the
 * user chose.
 *
 * A resource that is on disk elsewhere — a mirror, or a root another Shiro build
 * downloaded to — is still `missing` here, but carries `availableElsewhere` so
 * the panel can say where its files are instead of pretending they are not there
 * (`resourcePresence.ts`).
 */
export type ResourceStatus = 'ready' | 'missing';

/** Repository details surfaced to the wizard (no endpoints, just facts). */
export interface ResourceRepoView {
  repo: string;
  /** File count / size recorded by the last successful pull. */
  fileCount?: number;
  sizeBytes?: number;
  /** Site that produced the local copy. */
  site?: ModelSiteId;
  siteLabel?: string;
  completedAt?: string;
}

export interface ResourceStatusView {
  id: string;
  label: string;
  feature: ResourceManifestEntry['feature'];
  sizeBytes: number;
  description: string;
  status: ResourceStatus;
  /**
   * Directory where the files are usable even though the *chosen* root does not
   * hold a completed pull — a mirror, or a root another Shiro build downloaded to
   * (`sharedModelRoots.ts`).
   *
   * Without this the panel would call a demonstrably present model "待下载" and
   * offer a 1.4 GB download for files that are already on the disk.
   */
  availableElsewhere?: string;
  repo?: ResourceRepoView;
}

export type ProvisioningDownloadEvent =
  | { type: 'resource-start'; id: string; label: string; totalBytes: number; repo?: string }
  | { type: 'site-attempt'; id: string; site: ModelSiteId; siteLabel: string; repo: string }
  | { type: 'site-listed'; id: string; site: ModelSiteId; fileCount: number; totalBytes: number }
  | { type: 'site-failed'; id: string; site: ModelSiteId; siteLabel: string; error: string }
  | { type: 'file-start'; id: string; path: string; index: number; fileCount: number }
  | { type: 'progress'; id: string; receivedBytes: number; totalBytes: number }
  | { type: 'resource-done'; id: string; site?: ModelSiteId; files?: number }
  | { type: 'resource-skipped'; id: string; reason: string }
  | { type: 'resource-error'; id: string; error: string }
  | { type: 'complete'; preparedResources: string[]; sites: Partial<Record<string, ModelSiteId>> };

/**
 * Owns first-run setup: the persisted selection and download directory, the
 * per-resource readiness report, the on-demand download stream that pulls remote
 * resources into the chosen directory, the asset route the webview reads them
 * back through, and the gate verdict the desktop shell picks its first window
 * with.
 */
export function provisioningApi(paths: ProjectPaths) {
  const readState = (): ProvisioningState => readProvisioningStateSync(paths);

  // A state written before the shared roots file existed (or by another build)
  // still says where the models are. Publishing it once per server start is what
  // makes an existing 1.4 GB cache visible to the *other* builds on this machine
  // without the user repeating the wizard.
  const persistedRoot = readState().downloadRoot.trim();
  if (persistedRoot) void publishSharedModelRoot(persistedRoot, process.env);

  /**
   * The first-run verdict, for the desktop shell.
   *
   * `src-tauri/src/provisioning_gate.rs` asks this before choosing which window to
   * open, so the rule lives where the manifest is rather than being re-derived in
   * Rust. Kept tiny on purpose: it is fetched with a short timeout while the app
   * is still starting.
   */
  const handleGate = async (
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse
  ) => {
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'Provisioning gate only supports GET' });
      return;
    }
    sendJson(response, 200, await evaluateSetupGate(paths));
  };

  const handleState = async (
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse
  ) => {
    if (request.method === 'GET') {
      sendJson(response, 200, readState());
      return;
    }
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'Provisioning state only supports GET and POST' });
      return;
    }
    try {
      const body = JSON.parse(await readRequestText(request, 256 * 1024)) as unknown;
      const next = normalizeProvisioningState(body);
      await writeProvisioningState(paths, next);
      sendJson(response, 200, next);
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : 'Invalid provisioning state'
      });
    }
  };

  const handleResources = async (
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse
  ) => {
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'Provisioning resources only supports GET' });
      return;
    }
    const state = readState();
    const sharedRoots = readSharedModelRoots();
    // The wizard edits the directory in a text field before anything is
    // downloaded, so the report honours `?downloadRoot=` and answers for the path
    // being typed. Nothing is persisted: the choice is saved when the download
    // starts or the wizard finishes, exactly as before.
    const override = queryValue(request, 'downloadRoot');
    const downloadRoot = override ? path.resolve(override) : downloadRootOf(paths, state);
    const views: ResourceStatusView[] = [];
    for (const entry of RESOURCE_MANIFEST) {
      const { status, availableElsewhere, repo } = await statusOf(paths, entry, downloadRoot, sharedRoots);
      views.push({
        id: entry.id,
        label: entry.label,
        feature: entry.feature,
        sizeBytes: entry.sizeBytes,
        description: entry.description,
        status,
        ...(availableElsewhere ? { availableElsewhere } : {}),
        repo
      });
    }
    sendJson(response, 200, {
      preparedResources: state.preparedResources,
      modelSites: state.modelSites,
      // The wizard shows this in an editable field, so it must report the
      // resolved path (what would actually be used) and not just the raw setting.
      downloadRoot: state.downloadRoot,
      resolvedDownloadRoot: downloadRoot,
      defaultDownloadRoot: defaultDownloadRoot(paths),
      sharedRoots,
      resources: views
    });
  };

  /**
   * Streams a file out of a provisioned resource directory.
   *
   * Route: `GET /api/provisioning/assets/<resourceId>/<file path>`. The ASR
   * worker is the caller — see `provisioningAssets.ts` for why this indirection
   * exists at all.
   */
  const handleAsset = async (
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse,
    route: string
  ) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { error: 'Provisioning assets only support GET' });
      return;
    }
    const tail = route.slice(`${PROVISIONING_API_PATH}/assets/`.length);
    let resourceId: string;
    let filePath: string;
    try {
      const segments = tail.split('/');
      resourceId = decodeURIComponent(segments[0] ?? '');
      filePath = segments.slice(1).map(decodeURIComponent).join('/');
    } catch {
      sendJson(response, 400, { error: 'Malformed asset path' });
      return;
    }

    const entry = getResourceEntry(resourceId);
    const asset = entry
      ? resolveResourceAsset(resourceRoots(paths, entry, undefined, readSharedModelRoots()), filePath)
      : null;
    if (!asset) {
      // A 404 here is the documented signal for "this model is not in place";
      // the ASR worker turns it into an actionable message.
      sendJson(response, 404, { error: `资源文件不存在：${resourceId}/${filePath}` });
      return;
    }

    response.writeHead(200, {
      'Content-Type': asset.contentType,
      'Content-Length': String(asset.sizeBytes),
      // Model files run to hundreds of megabytes; never let a stale copy win over
      // a freshly re-downloaded one.
      'Cache-Control': 'no-store'
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(asset.absolutePath).pipe(response);
  };

  const handleDownload = async (
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse
  ) => {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'Provisioning download only supports POST' });
      return;
    }
    let requested: string[] = [];
    let requestedSites: ModelSiteId[] | null = null;
    let requestedRoot: string | null = null;
    try {
      const body = JSON.parse(await readRequestText(request, 64 * 1024)) as {
        resourceIds?: unknown;
        modelSites?: unknown;
        downloadRoot?: unknown;
      };
      if (Array.isArray(body.resourceIds)) {
        requested = body.resourceIds.filter((id): id is string => typeof id === 'string');
      }
      if (body.modelSites !== undefined) requestedSites = normalizeModelSiteOrder(body.modelSites);
      if (typeof body.downloadRoot === 'string' && body.downloadRoot.trim()) {
        requestedRoot = body.downloadRoot.trim();
      }
    } catch {
      sendJson(response, 400, { error: 'Invalid download request' });
      return;
    }

    const origin = request.headers.origin;
    if (origin && isAllowedLocalOrigin(request)) {
      response.setHeader('Access-Control-Allow-Origin', origin);
    }
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const send = (event: ProvisioningDownloadEvent): void => {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // The directory the user just typed wins, and is persisted before the first
    // byte is fetched: a model must never land somewhere the asset route will not
    // look for it after a restart.
    const state = readState();
    const downloadRoot = requestedRoot
      ? downloadRootOf(paths, { ...state, downloadRoot: requestedRoot })
      : downloadRootOf(paths, state);
    if (downloadRoot !== downloadRootOf(paths, state)) {
      await writeProvisioningState(paths, { ...createDefaultProvisioningState(), ...state, downloadRoot });
    }

    const rootProblem = downloadRootProblem(downloadRoot);
    if (rootProblem) {
      // Fail once, clearly, before touching the network.
      for (const id of requested) send({ type: 'resource-error', id, error: rootProblem });
      send({ type: 'complete', preparedResources: [], sites: {} });
      response.end();
      return;
    }

    const abort = new AbortController();
    request.on('close', () => abort.abort());
    const prepared = new Set<string>();
    const usedSites: Partial<Record<string, ModelSiteId>> = {};

    // Preference: request override → persisted preference → default order.
    const siteOrder = requestedSites ?? state.modelSites;

    for (const id of requested) {
      const entry = getResourceEntry(id);
      if (!entry) {
        send({ type: 'resource-skipped', id, reason: 'unknown resource' });
        continue;
      }

      const existing = await repoMarkerOf(paths, entry, downloadRoot);
      if (existing) {
        prepared.add(id);
        usedSites[id] = existing.site;
        send({ type: 'resource-skipped', id, reason: 'already present' });
        continue;
      }

      send({
        type: 'resource-start',
        id,
        label: entry.label,
        totalBytes: entry.sizeBytes,
        repo: entry.repo.repo
      });

      // Try each site in order; the first that completes the whole repository
      // wins. A failure is reported but never aborts the remaining sites.
      const failures: string[] = [];
      const directory = resourceRoots(paths, entry, downloadRoot)[0];
      let done = false;
      for (const siteId of siteOrder) {
        if (abort.signal.aborted) break;
        const site = getModelSite(siteId);
        send({
          type: 'site-attempt',
          id,
          site: siteId,
          siteLabel: site.label,
          repo: entry.repo.repo
        });
        try {
          const result = await downloadModelRepo(site, entry.repo, directory, {
            signal: abort.signal,
            onListed: (files) =>
              send({
                type: 'site-listed',
                id,
                site: siteId,
                fileCount: files.length,
                totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0)
              }),
            onFileStart: (file, index, fileCount) =>
              send({
                type: 'file-start',
                id,
                path: file.path,
                index: Math.min(index + 1, fileCount),
                fileCount
              }),
            onProgress: (receivedBytes, totalBytes) =>
              send({ type: 'progress', id, receivedBytes, totalBytes })
          });
          prepared.add(id);
          usedSites[id] = siteId;
          send({ type: 'resource-done', id, site: siteId, files: result.files.length });
          done = true;
          break;
        } catch (error) {
          if (abort.signal.aborted) break;
          const message = error instanceof Error ? error.message : 'download failed';
          failures.push(`${site.label}：${message}`);
          send({ type: 'site-failed', id, site: siteId, siteLabel: site.label, error: message });
        }
      }

      if (!done) {
        if (abort.signal.aborted) {
          send({ type: 'resource-error', id, error: 'aborted' });
          break;
        }
        send({
          type: 'resource-error',
          id,
          error:
            failures.length > 0 ? `所有下载源均失败 — ${failures.join('；')}` : 'no download site available'
        });
      }
    }

    send({ type: 'complete', preparedResources: [...prepared], sites: usedSites });
    response.end();
  };

  const configure = (server: MiddlewareHost) => {
    server.middlewares.use(async (request, response, next) => {
      const route = apiPathOf(request);
      if (route === `${PROVISIONING_API_PATH}/gate`) {
        await handleGate(request, response);
        return;
      }
      if (route === `${PROVISIONING_API_PATH}/state`) {
        await handleState(request, response);
        return;
      }
      if (route === `${PROVISIONING_API_PATH}/resources`) {
        await handleResources(request, response);
        return;
      }
      if (route === `${PROVISIONING_API_PATH}/download`) {
        await handleDownload(request, response);
        return;
      }
      if (route.startsWith(`${PROVISIONING_API_PATH}/assets/`)) {
        await handleAsset(request, response, route);
        return;
      }
      next();
    });
  };

  return {
    name: 'provisioning',
    configureServer: configure,
    configurePreviewServer: configure
  };
}

/** Marker for a repository pulled into the download root (mirrors do not count). */
async function repoMarkerOf(
  paths: ProjectPaths,
  entry: ResourceManifestEntry,
  downloadRoot: string
): Promise<RepoMarker | null> {
  // Only the first root can be "ready"; the shared roots are never written to, so
  // they cannot turn a resource into something this root owns.
  return readModelRepoMarker(resourceRoots(paths, entry, downloadRoot)[0]);
}

async function statusOf(
  paths: ProjectPaths,
  entry: ResourceManifestEntry,
  downloadRoot: string,
  sharedRoots: readonly string[]
): Promise<{ status: ResourceStatus; availableElsewhere?: string; repo?: ResourceRepoView }> {
  const roots = resourceRoots(paths, entry, downloadRoot, sharedRoots);
  const located = await locateResource(roots, entry);
  if (!located.marker) {
    return {
      status: 'missing',
      ...(located.state === 'usable' && located.directory ? { availableElsewhere: located.directory } : {}),
      repo: { repo: entry.repo.repo }
    };
  }
  return {
    status: 'ready',
    repo: {
      repo: located.marker.repo,
      fileCount: located.marker.files.length,
      sizeBytes: located.marker.bytes || entry.sizeBytes,
      site: located.marker.site,
      siteLabel: modelSiteLabel(located.marker.site),
      completedAt: located.marker.completedAt
    }
  };
}

/** Value of one query parameter, decoded; `null` when absent or malformed. */
function queryValue(request: import('node:http').IncomingMessage, key: string): string | null {
  try {
    const value = new URL(request.url ?? '', 'http://127.0.0.1').searchParams.get(key);
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}
