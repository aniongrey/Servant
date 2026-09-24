import { useCallback, useEffect, useMemo, useState } from 'react';
import { FEATURE_PRESENTATION, featurePresentation, featuresFromResources } from './featureCatalog.ts';
import {
  downloadResources,
  formatBytes,
  getProvisioningState,
  getResourceReport,
  saveProvisioningState
} from './provisioningClient.ts';
import type { ProvisioningDownloadEvent, ResourceStatusView } from '../network/server/provisioningApi.ts';
import {
  createDefaultProvisioningState,
  DEFAULT_MODEL_SITE_ORDER,
  MODEL_SITE_OPTIONS,
  modelSiteLabel,
  normalizeModelSiteOrder,
  type ModelSiteId,
  type ProvisioningState
} from './provisioningTypes.ts';
import './SetupWizard.css';
import { pickDirectory } from '../../desktop/tauri/directoryPicker';
import { isTauriDesktop, openChatWindow, openSettingsWindow } from '../../desktop/tauri/navigation';

/**
 * The setup panel does exactly one job: download the resources the user's chosen
 * capabilities need, into the user data directory.
 *
 * Everything else deliberately lives elsewhere — the LLM provider and voice
 * configuration belong to the settings window, and anything the installer
 * already ships (the sherpa-onnx WASM runtime, the Python memory environment) is
 * not listed here at all, because there is nothing to prepare for it.
 */
type Phase = 'select' | 'prepare' | 'done';

interface ResourceProgress {
  status: 'pending' | 'downloading' | 'done' | 'skipped' | 'error';
  received: number;
  total: number;
  label: string;
  error?: string;
  /** Which site is currently serving this resource. */
  site?: ModelSiteId;
  /** File currently transferring, e.g. `3/13`. */
  fileIndex?: number;
  fileCount?: number;
  /** Sites tried and rejected before the current one. */
  failedSites?: string[];
  /** Why the backend skipped this resource. */
  reason?: string;
}

export function SetupWizard() {
  const [phase, setPhase] = useState<Phase>('select');
  const [views, setViews] = useState<ResourceStatusView[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [sites, setSites] = useState<ModelSiteId[]>([...DEFAULT_MODEL_SITE_ORDER]);
  /** Raw user choice; empty means "use the default beside the app". */
  const [downloadRoot, setDownloadRoot] = useState('');
  const [defaultRoot, setDefaultRoot] = useState('');

  const [progress, setProgress] = useState<Record<string, ResourceProgress>>({});
  const [busy, setBusy] = useState(false);
  const [prepareComplete, setPrepareComplete] = useState(false);
  const [hadErrors, setHadErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The directory the last authoritative report was made for; the field may differ. */
  const [persistedRoot, setPersistedRoot] = useState('');

  /** The head of the order is the user's choice; the rest is the fallback chain. */
  const preferredSite = sites[0] ?? DEFAULT_MODEL_SITE_ORDER[0];
  /** What would actually be used if the download started now. */
  const effectiveRoot = downloadRoot.trim() || defaultRoot;

  const applyReport = useCallback(async (): Promise<void> => {
    const report = await getResourceReport();
    setViews(report.resources);
    setSites(report.modelSites);
    setDownloadRoot(report.downloadRoot);
    setPersistedRoot(report.downloadRoot);
    setDefaultRoot(report.defaultDownloadRoot || report.resolvedDownloadRoot);
    // Anything missing starts out selected: the panel's job is to fetch it, and
    // opting *out* is the deliberate action. The exception is a resource whose
    // files are already usable in a directory the runtime reads: selecting it
    // would re-download 1.4 GB to move files that are not missing at all.
    setSelected((prev) => {
      const next: Record<string, boolean> = {};
      for (const resource of report.resources) {
        next[resource.id] = resource.availableElsewhere
          ? prev[resource.id] ?? false
          : resource.status === 'ready'
          ? true
          : prev[resource.id] ?? true;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await applyReport();
      } catch (reportError) {
        setError(reportError instanceof Error ? reportError.message : '无法读取资源状态');
      }
      try {
        const state = await getProvisioningState();
        setSites(state.modelSites);
      } catch {
        // Keep the default order.
      }
    })();
  }, [applyReport]);

  /**
   * Answers for the directory being typed before anything is downloaded.
   *
   * Without this, pointing the field at a folder that already holds the models
   * keeps saying "待下载" until a download starts and reports "already present" —
   * the user is asked to press a button labelled 1.4 GB for files that are right
   * there. Only the resource list is refreshed: the field must keep what the user
   * is typing, and nothing is persisted (saving happens when the download starts
   * or the wizard finishes).
   */
  useEffect(() => {
    const typed = downloadRoot.trim();
    if (busy || typed === persistedRoot) return;
    const timer = setTimeout(() => {
      void getResourceReport(typed || undefined)
        .then((report) => setViews(report.resources))
        .catch(() => undefined);
    }, 400);
    return () => clearTimeout(timer);
  }, [busy, downloadRoot, persistedRoot]);

  const pending = useMemo(() => views.filter((view) => view.status === 'missing'), [views]);
  const ready = useMemo(() => views.filter((view) => view.status === 'ready'), [views]);
  const selectedPending = useMemo(() => pending.filter((view) => selected[view.id]), [pending, selected]);

  const selectSite = useCallback((site: ModelSiteId) => {
    setSites(normalizeModelSiteOrder([site, ...DEFAULT_MODEL_SITE_ORDER]));
  }, []);

  const onDownloadEvent = useCallback((event: ProvisioningDownloadEvent) => {
    if (event.type === 'complete') return;
    const id = event.id;
    setProgress((prev) => {
      const current: ResourceProgress = prev[id] ?? { status: 'pending', received: 0, total: 0, label: id };
      return { ...prev, [id]: foldDownloadEvent(current, event) };
    });
    if (event.type === 'resource-error') setHadErrors(true);
  }, []);

  const runDownload = useCallback(
    async (resourceIds: string[], siteOrder: ModelSiteId[], root: string) => {
      setBusy(true);
      setPrepareComplete(false);
      setHadErrors(false);
      setProgress({});
      try {
        await downloadResources(
          {
            resourceIds,
            modelSites: siteOrder,
            ...(root.trim() ? { downloadRoot: root.trim() } : {})
          },
          onDownloadEvent
        );
      } catch (downloadError) {
        setHadErrors(true);
        setError(downloadError instanceof Error ? downloadError.message : '资源下载失败');
      } finally {
        try {
          await applyReport();
        } catch {
          // The per-resource events already told the user what happened.
        }
        setBusy(false);
        setPrepareComplete(true);
      }
    },
    [applyReport, onDownloadEvent]
  );

  const startDownload = useCallback(async () => {
    setError(null);
    setNotice(null);
    setPhase('prepare');
    await runDownload(
      selectedPending.map((view) => view.id),
      sites,
      downloadRoot
    );
  }, [downloadRoot, runDownload, selectedPending, sites]);

  /**
   * Demotes the preferred site to the end of the fallback chain and retries.
   * Finishing then persists the new order, so the source that actually worked
   * becomes the preferred one next launch.
   */
  const retryWithNextSite = useCallback(async () => {
    const [first, ...rest] = sites;
    const rotated = normalizeModelSiteOrder([...rest, ...(first ? [first] : [])]);
    setSites(rotated);
    setError(null);
    await runDownload(
      pending.filter((view) => selected[view.id]).map((view) => view.id),
      rotated,
      downloadRoot
    );
  }, [downloadRoot, pending, runDownload, selected, sites]);

  const nextSite = sites[1];

  /**
   * Asks the OS for a directory. The path is only written to the field — it is
   * persisted when the download starts, so a change of mind costs nothing.
   */
  const chooseDownloadDirectory = useCallback(async () => {
    setNotice(null);
    const outcome = await pickDirectory({
      title: '选择模型下载目录',
      defaultPath: effectiveRoot.trim()
    });
    if (outcome.kind === 'picked') {
      setDownloadRoot(outcome.path);
      return;
    }
    if (outcome.kind === 'unavailable') {
      setNotice('当前不在桌面端，无法选择目录，请手动填写路径。');
    } else if (outcome.kind === 'failed') {
      setNotice(`无法打开目录选择器：${outcome.message}`);
    }
    // Cancelling needs no message: the field simply keeps its value.
  }, [effectiveRoot]);

  const finish = useCallback(async () => {
    setError(null);
    let installed = ready;
    try {
      const report = await getResourceReport();
      setViews(report.resources);
      installed = report.resources.filter((view) => view.status === 'ready');
    } catch {
      // Fall back to what the last report said.
    }
    const state: ProvisioningState = {
      ...createDefaultProvisioningState(),
      setupComplete: true,
      downloadRoot: downloadRoot.trim(),
      features: featuresFromResources(installed),
      modelSites: sites,
      preparedResources: installed.map((view) => view.id)
    };
    try {
      await saveProvisioningState(state);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '无法保存初始化状态');
      return;
    }
    setPhase('done');
    // The wizard only fetches resources; the first thing the user has to fill in
    // themselves is the LLM provider, so the last step hands them the chat window
    // and the settings window already standing on that panel. The settings window
    // opens last so it is the one holding focus.
    await openChatWindow();
    await openSettingsWindow('llm');
    if (isTauriDesktop()) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().close();
      } catch {
        // If the Tauri bridge misbehaves, leave the success screen up.
      }
    }
  }, [downloadRoot, ready, sites]);

  const progressRows = useMemo(
    () => (phase === 'prepare' ? pending.concat(progressOnlyViews(views, progress)) : []),
    [pending, phase, progress, views]
  );

  return (
    <div className="sw-root">
      <header className="sw-header">
        <div className="sw-logo">✨ Servant</div>
        <h1>初始化</h1>
        <p className="sw-subtitle">
          选择下载源，Servant 会把需要的模型下载到你的用户目录；随安装包提供的部分无需准备。
        </p>
      </header>

      <main className="sw-body">
        <section className="sw-section">
          <h2>下载源</h2>
          <div className="sw-site-grid">
            {MODEL_SITE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`sw-site-card ${preferredSite === option.id ? 'is-on' : ''}`}
                onClick={() => selectSite(option.id)}
                disabled={busy}
                aria-pressed={preferredSite === option.id}
              >
                <span className="sw-site-label">
                  {option.label}
                  {option.id === DEFAULT_MODEL_SITE_ORDER[0] && <span className="sw-badge">默认</span>}
                </span>
                <span className="sw-site-hint">{option.hint}</span>
              </button>
            ))}
          </div>
          <p className="sw-field-hint">
            下载失败会自动依次尝试其余站点，回退顺序：{sites.map((id) => modelSiteLabel(id)).join(' → ')}
          </p>
        </section>

        <section className="sw-section">
          <h2>下载位置</h2>
          <div className="sw-dir-row">
            <input
              className="sw-dir-input"
              value={downloadRoot}
              onChange={(event) => setDownloadRoot(event.target.value)}
              placeholder={defaultRoot || '默认：应用目录下的 models 文件夹'}
              disabled={busy}
              spellCheck={false}
              aria-label="模型下载目录"
            />
            <button type="button" className="sw-btn" onClick={chooseDownloadDirectory} disabled={busy}>
              选择目录
            </button>
          </div>
          <p className="sw-field-hint">
            模型体积较大（合计约 1.4GB），建议放到空间充足的磁盘。留空则使用{' '}
            {defaultRoot || '应用目录下的 models'}。
          </p>
        </section>

        {phase === 'select' && (
          <section className="sw-section">
            <h2>需要准备的资源</h2>
            {views.length === 0 && <p className="sw-field-hint">正在读取…</p>}
            {views.map((view) => {
              const feature = featurePresentation(view.feature);
              const isReady = view.status === 'ready';
              const elsewhere = isReady ? undefined : view.availableElsewhere;
              const isOn = isReady || Boolean(selected[view.id]);
              return (
                <button
                  key={view.id}
                  type="button"
                  className={`sw-res-card ${isOn ? 'is-on' : ''} ${isReady ? 'is-ready' : ''}`}
                  onClick={() => setSelected((prev) => ({ ...prev, [view.id]: !prev[view.id] }))}
                  disabled={isReady || busy}
                  aria-pressed={isOn}
                >
                  <span className={`sw-res-check ${isOn ? 'on' : ''}`}>{isOn ? '✓' : ''}</span>
                  <span className="sw-res-main">
                    <span className="sw-res-head">
                      <span className="sw-feature-chip">
                        {feature.icon} {feature.title}
                      </span>
                      <span className="sw-res-title">{view.label}</span>
                    </span>
                    <span className="sw-res-desc">{view.description}</span>
                    {elsewhere && (
                      <span className="sw-res-elsewhere" title={elsewhere}>
                        已在 {elsewhere} 可用，不必再下载；勾选可另存到上面选的目录。
                      </span>
                    )}
                  </span>
                  <span className="sw-res-side">
                    <span className="sw-res-size">{formatBytes(view.sizeBytes)}</span>
                    <span className={`sw-res-state ${isReady ? 'is-ok' : ''}`}>
                      {isReady
                        ? `已就绪${view.repo?.fileCount ? ` · ${view.repo.fileCount} 个文件` : ''}`
                        : elsewhere
                        ? '已在其它位置可用'
                        : '待下载'}
                    </span>
                    {isReady && view.repo?.siteLabel && (
                      <span className="sw-res-origin">来源 {view.repo.siteLabel}</span>
                    )}
                  </span>
                </button>
              );
            })}
            {pending.length > 0 && selectedPending.length === 0 && (
              <p className="sw-field-hint">
                缺少的 {pending.length} 项已在其它位置可用，不需要下载即可开始使用。
              </p>
            )}
            {ready.length > 0 && pending.length > 0 && selectedPending.length > 0 && (
              <p className="sw-field-hint">
                已就绪 {ready.length} 项，取消勾选可跳过其余下载；缺失的资源稍后可在设置中重新下载。
              </p>
            )}
          </section>
        )}

        {phase !== 'select' && (
          <section className="sw-section">
            <h2>{phase === 'done' ? '初始化完成' : '正在下载'}</h2>
            <ul className="sw-resource-list">
              {progressRows.map((view) => {
                const item = progress[view.id];
                const label = item?.label ?? view.label;
                const pct =
                  item && item.total > 0
                    ? Math.min(100, Math.round((item.received / item.total) * 100))
                    : null;
                const detail = (() => {
                  if (!item) return null;
                  if (item.status === 'downloading') {
                    const parts: string[] = [];
                    if (item.site) parts.push(`来源 ${modelSiteLabel(item.site)}`);
                    if (item.fileIndex && item.fileCount)
                      parts.push(`文件 ${item.fileIndex}/${item.fileCount}`);
                    return parts.join(' · ');
                  }
                  return null;
                })();
                return (
                  <li key={view.id} className={`sw-resource sw-resource-${item?.status ?? 'pending'}`}>
                    <div className="sw-resource-main">
                      <span className="sw-resource-icon">
                        {item?.status === 'done'
                          ? '✅'
                          : item?.status === 'error'
                          ? '⚠️'
                          : item?.status === 'skipped'
                          ? '✅'
                          : item?.status === 'downloading'
                          ? '⏳'
                          : '⚪'}
                      </span>
                      <span className="sw-resource-label">{label}</span>
                      <span className="sw-resource-status">
                        {item?.status === 'downloading' && pct !== null && (
                          <span className="sw-bar">
                            <span className="sw-bar-fill" style={{ width: `${pct}%` }} />
                          </span>
                        )}
                        {item?.status === 'downloading' && pct === null && '准备中…'}
                        {item?.status === 'done' && '已下载'}
                        {item?.status === 'skipped' && '已就绪'}
                        {item?.status === 'error' && (item.error ?? '失败')}
                        {!item && '等待中…'}
                      </span>
                      {item && item.total > 0 && item.status === 'downloading' && (
                        <span className="sw-resource-size">
                          {formatBytes(item.received)} / {formatBytes(item.total)}
                        </span>
                      )}
                    </div>
                    {(detail || item?.failedSites?.length) && (
                      <div className="sw-resource-detail">
                        {detail}
                        {item?.failedSites?.map((failure) => (
                          <span key={failure} className="sw-resource-fallback">
                            ↷ 已回退 — {failure}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {prepareComplete && hadErrors && (
              <p className="sw-warning">
                部分资源未能下载（通常是网络限制）。脚本已依次尝试全部下载源；可以换一个源重试，或先跳过，
                稍后在设置中补齐 —— 跳过的功能在补齐前不可用。
              </p>
            )}
            {phase === 'done' && (
              <p className="sw-hint">已就绪 {ready.length} 项。对话、语音与人设可在设置窗口中随时调整。</p>
            )}
          </section>
        )}
      </main>

      <footer className="sw-footer">
        {error && <span className="sw-footer-error">{error}</span>}
        {!error && notice && <span className="sw-footer-error sw-footer-notice">{notice}</span>}
        <div className="sw-footer-actions">
          {phase === 'select' && views.length === 0 && (
            <button
              type="button"
              className="sw-btn"
              onClick={() => {
                setError(null);
                void applyReport().catch((reportError) =>
                  setError(reportError instanceof Error ? reportError.message : '无法读取资源状态')
                );
              }}
            >
              重新读取
            </button>
          )}
          {phase === 'select' && views.length > 0 && (
            <button
              type="button"
              className="sw-btn sw-btn-primary"
              onClick={startDownload}
              disabled={busy || selectedPending.length === 0}
            >
              {selectedPending.length === 0 ? '资源已就绪' : `开始下载（${selectedPending.length} 项）`}
            </button>
          )}
          {phase === 'select' && views.length > 0 && selectedPending.length === 0 && (
            <button type="button" className="sw-btn sw-btn-primary" onClick={finish}>
              进入 Servant
            </button>
          )}
          {phase === 'prepare' && !prepareComplete && (
            <button type="button" className="sw-btn" disabled>
              下载中…
            </button>
          )}
          {phase === 'prepare' && prepareComplete && hadErrors && (
            <button type="button" className="sw-btn" onClick={retryWithNextSite} disabled={busy}>
              换源重试{nextSite ? `（${modelSiteLabel(nextSite)}）` : ''}
            </button>
          )}
          {phase === 'prepare' && prepareComplete && (
            <button type="button" className="sw-btn sw-btn-primary" onClick={finish}>
              {hadErrors ? '跳过并继续' : '完成'}
            </button>
          )}
          {phase === 'done' && !('__TAURI_INTERNALS__' in window) && (
            <button type="button" className="sw-btn sw-btn-primary" onClick={() => window.close()}>
              关闭
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

/**
 * Folds one backend event into the row state for the resource it names.
 *
 * Kept out of the React callback so the discriminated union narrows properly —
 * inside a nested closure TypeScript drops the narrowing and every field access
 * becomes an error.
 */
function foldDownloadEvent(
  current: ResourceProgress,
  event: Exclude<ProvisioningDownloadEvent, { type: 'complete' }>
): ResourceProgress {
  switch (event.type) {
    case 'resource-start':
      return {
        status: 'downloading',
        received: 0,
        total: event.totalBytes,
        label: event.label
      };
    case 'site-attempt':
      return { ...current, status: 'downloading', received: 0, total: 0, site: event.site };
    case 'site-listed':
      return {
        ...current,
        status: 'downloading',
        received: 0,
        total: event.totalBytes,
        fileCount: event.fileCount
      };
    case 'site-failed':
      return {
        ...current,
        failedSites: [...(current.failedSites ?? []), `${event.siteLabel}：${event.error}`]
      };
    case 'file-start':
      return { ...current, status: 'downloading', fileIndex: event.index, fileCount: event.fileCount };
    case 'progress':
      return {
        ...current,
        status: 'downloading',
        received: event.receivedBytes,
        total: event.totalBytes
      };
    case 'resource-done':
      return { ...current, status: 'done', received: current.total, site: event.site ?? current.site };
    case 'resource-skipped':
      return { ...current, status: 'skipped', reason: event.reason };
    case 'resource-error':
      return { ...current, status: 'error', error: event.error };
  }
}

/**
 * A resource that only exists in the progress log — a row the report no longer
 * lists because it was replaced mid-flight. Keeps the panel from dropping a line
 * the user is watching.
 */
function progressOnlyViews(
  views: ResourceStatusView[],
  progress: Record<string, ResourceProgress>
): ResourceStatusView[] {
  const known = new Set(views.map((view) => view.id));
  return Object.entries(progress)
    .filter(([id]) => !known.has(id))
    .map(([id, item]) => ({
      id,
      label: item.label,
      feature: FEATURE_PRESENTATION[0].id,
      sizeBytes: item.total,
      description: '',
      status: 'missing' as const
    }));
}
