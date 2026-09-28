import { useEffect, useState } from 'react';
import { resolveVrmModelOption } from '../../character/vrm/assets/vrmModels';
import { loadAvatarFitConfig, normalizeCharacterAvatarFit } from '../../character/ik/avatarFitSettings';
import {
  loadCharacterRenderConfig,
  normalizeCharacterRenderConfig
} from '../../character/vrm/characterRenderSettings';
import { readStoredJson } from '../../app/settings/browserStorage';
import { listImportedVrms, saveImportedVrm } from '../../character/vrm/ImportedVrmStore';
import { createImportedModelUrl } from '../../character/vrm/importedModelUrl';
import { backendFetch } from '../../app/network/backendFetch';
import {
  DESKTOP_MODEL_CACHE_ID,
  isDesktopCharacterSettings,
  type DesktopCharacterSettings
} from './characterSettings';
import { listenDesktopRealtimeSync } from '../../app/network/realtime/DesktopRealtimeSync';
import { loadCharacterProportionConfig } from '../../character/vrm/characterProportionSettings';
import { normalizeCharacterProportionConfig } from '../../character/vrm/CharacterProportion';

const CACHE_KEY = 'codex-list.desktopCharacter.v1';

function normalizeSettings(settings: DesktopCharacterSettings): DesktopCharacterSettings {
  return {
    ...settings,
    renderConfig: normalizeCharacterRenderConfig(settings.renderConfig),
    proportionConfig: normalizeCharacterProportionConfig(settings.proportionConfig),
    avatarFit: { ...normalizeCharacterAvatarFit(settings.avatarFit), showGuide: false }
  };
}

function initialSettings(): DesktopCharacterSettings {
  const cache = readStoredJson(CACHE_KEY);
  if (isDesktopCharacterSettings(cache)) return normalizeSettings(cache);
  return normalizeSettings({
    version: 1,
    model: { id: localStorage.getItem('codex-list.vrmModelSelection.v1') ?? 'main' },
    avatarFit: loadAvatarFitConfig(),
    renderConfig: loadCharacterRenderConfig(),
    proportionConfig: loadCharacterProportionConfig(),
    holdMicroMotionEnabled: localStorage.getItem('codex-list.holdMicroMotionEnabled.v1') === 'true',
    footIkEnabled: localStorage.getItem('codex-list.footIkEnabled.v1') === 'true'
  });
}

export function useDesktopCharacter() {
  const [character, setCharacter] = useState(() => {
    const settings = initialSettings();
    return { settings, modelUrl: resolveVrmModelOption(settings.model.id).url };
  });
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    let currentUrl: { url: string; dispose(): void } | undefined;
    let currentBlob: Blob | undefined;
    let currentAsset: string | undefined;
    let lastSettings = '';
    /* Bytes of every model the user imported, by record id. A published imported MMD
       folder never gets an asset hash — the backend only accepts GLB — so the
       published model id is the only way back to its bytes. */
    let importedBlobs = new Map<string, Blob>();
    const controller = new AbortController();
    const replaceModel = (settings: DesktopCharacterSettings, blob?: Blob) => {
      const next = normalizeSettings(settings);
      // Same bytes, same URL: a settings-only change (a proportion slider, a
      // toggle) must not make the stage reload a 13 MiB model.
      if (blob === currentBlob && currentUrl) {
        setCharacter({ settings: next, modelUrl: currentUrl.url });
        return;
      }
      // Anything with bytes behind it is an import, and an imported MMD folder is
      // a container the loader can only make sense of through this registration.
      const handle = blob ? createImportedModelUrl(blob) : undefined;
      const previous = currentUrl;
      currentUrl = handle;
      currentBlob = blob;
      setCharacter({
        settings: next,
        modelUrl: handle?.url ?? resolveVrmModelOption(settings.model.id).url
      });
      previous?.dispose();
    };
    const refresh = async () => {
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
        const response = await backendFetch('/api/desktop-character', { cache: 'no-store', signal });
        if (response.status === 404) return;
        if (!response.ok) throw new Error(`角色设置读取失败 (${response.status})`);
        const settings: unknown = await response.json();
        if (!isDesktopCharacterSettings(settings)) throw new Error('角色设置接口返回格式无效');
        const signature = JSON.stringify(settings);
        if (signature === lastSettings || disposed) return;
        if (settings.model.asset && currentAsset !== settings.model.asset) {
          const asset = await backendFetch(settings.model.asset, { signal });
          if (!asset.ok) throw new Error(`角色模型读取失败 (${asset.status})`);
          const blob = await asset.blob();
          if (disposed) return;
          await saveImportedVrm({
            id: DESKTOP_MODEL_CACHE_ID,
            name: settings.model.asset,
            size: blob.size,
            createdAt: Date.now(),
            blob
          }).catch((error) => console.error('Unable to cache desktop model for offline use', error));
          if (disposed) return;
          replaceModel(settings, blob);
        } else if (!settings.model.asset) {
          // No asset hash means either a bundled model (nothing to load by id) or an
          // imported one, whose bytes are in the store because they were never
          // uploaded. Passing `undefined` keeps the bundled behaviour.
          replaceModel(settings, importedBlobs.get(settings.model.id));
        } else {
          setCharacter((current) => ({ ...current, settings: normalizeSettings(settings) }));
        }
        currentAsset = settings.model.asset;
        lastSettings = signature;
        localStorage.setItem(CACHE_KEY, signature);
        setError('');
      } catch (error) {
        if (!disposed)
          setError(`暂用本地角色：${error instanceof Error ? error.message : '角色设置服务不可用'}`);
      }
    };
    const unsubscribeSync = listenDesktopRealtimeSync(
      (event) => {
        if (event.type === 'character-settings-changed') void refresh();
      },
      () => void refresh()
    );
    void (async () => {
      try {
        const records = await listImportedVrms();
        if (disposed) return;
        importedBlobs = new Map(records.map((record) => [record.id, record.blob]));
        const settings = initialSettings();
        // With an asset hash the published bytes are cached here under
        // DESKTOP_MODEL_CACHE_ID; without one the published model id is the whole
        // reference, and the last branch covers a first run where no server answered.
        const saved = settings.model.asset
          ? records.find(
              (record) => record.id === DESKTOP_MODEL_CACHE_ID && record.name === settings.model.asset
            )?.blob
          : importedBlobs.get(settings.model.id) ??
            (!isDesktopCharacterSettings(readStoredJson(CACHE_KEY))
              ? importedBlobs.get(localStorage.getItem('codex-list.importedVrmSelection.v1') ?? '')
              : undefined);
        if (saved) {
          replaceModel(settings, saved);
          currentAsset = settings.model.asset;
        }
      } catch (error) {
        console.error('Unable to restore cached desktop model', error);
      }
      if (!disposed) await refresh();
    })();
    return () => {
      disposed = true;
      controller.abort();
      unsubscribeSync();
      currentUrl?.dispose();
    };
  }, []);
  return { ...character, error };
}
