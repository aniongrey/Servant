import { useEffect, useState } from 'react';
import { resolveVrmModelOption } from '../../character/vrm/assets/vrmModels';
import { loadAvatarFitConfig, normalizeCharacterAvatarFit } from '../../character/ik/avatarFitSettings';
import {
  loadCharacterRenderConfig,
  normalizeCharacterRenderConfig
} from '../../character/vrm/characterRenderSettings';
import { readStoredJson } from '../../app/settings/browserStorage';
import { listImportedVrms, saveImportedVrm } from '../../character/vrm/ImportedVrmStore';
import { backendFetch } from '../../app/network/backendFetch';
import {
  isDesktopCharacterSettings,
  type DesktopCharacterSettings
} from './characterSettings';
import { listenDesktopRealtimeSync } from '../../app/network/realtime/DesktopRealtimeSync';
import { loadCharacterProportionConfig } from '../../character/vrm/characterProportionSettings';
import { normalizeCharacterProportionConfig } from '../../character/vrm/CharacterProportion';

const CACHE_KEY = 'codex-list.desktopCharacter.v1';
const MODEL_CACHE_ID = 'desktop-shared-model';

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
    let objectUrl: string | undefined;
    let currentAsset: string | undefined;
    let lastSettings = '';
    const controller = new AbortController();
    const replaceModel = (settings: DesktopCharacterSettings, blob?: Blob) => {
      const nextUrl = blob ? URL.createObjectURL(blob) : resolveVrmModelOption(settings.model.id).url;
      const oldUrl = objectUrl;
      objectUrl = blob ? nextUrl : undefined;
      setCharacter({ settings: normalizeSettings(settings), modelUrl: nextUrl });
      if (oldUrl) URL.revokeObjectURL(oldUrl);
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
            id: MODEL_CACHE_ID,
            name: settings.model.asset,
            size: blob.size,
            createdAt: Date.now(),
            blob
          }).catch((error) => console.error('Unable to cache desktop model for offline use', error));
          if (disposed) return;
          replaceModel(settings, blob);
        } else if (!settings.model.asset) {
          replaceModel(settings);
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
        const settings = initialSettings();
        const saved = settings.model.asset
          ? records.find((record) => record.id === MODEL_CACHE_ID && record.name === settings.model.asset)
          : !isDesktopCharacterSettings(readStoredJson(CACHE_KEY))
          ? records.find((record) => record.id === localStorage.getItem('codex-list.importedVrmSelection.v1'))
          : undefined;
        if (saved) {
          replaceModel(settings, saved.blob);
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
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);
  return { ...character, error };
}
