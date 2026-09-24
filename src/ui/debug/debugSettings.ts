import {
  DEBUG_PANEL_SECTION_STORAGE_KEY,
  CHARACTER_RENDER_PANEL_OPEN_STORAGE_KEY,
  AVATAR_FIT_PANEL_OPEN_STORAGE_KEY,
  VRM_MODEL_SELECTION_STORAGE_KEY,
  VRMA_MOTION_TEST_SELECTION_STORAGE_KEY,
  GLOBAL_PROXY_ENABLED_STORAGE_KEY,
  GLOBAL_PROXY_URL_STORAGE_KEY,
  DEFAULT_GLOBAL_PROXY_URL,
  WEB_SEARCH_ENABLED_STORAGE_KEY
} from '../../app/settings/storageKeys';
import {
  type DebugPanelSectionState,
  debugPanelSectionDefaults,
  type DebugPanelSectionId,
  type VrmaMotionTestSelection
} from './debugConfig';

import { vrmModelOptions } from '../../character/vrm/assets/vrmModels';
import {
  vrmaManualTestMotions,
  vrmaMotionTestMaskOptions
} from '../../character/motion/assets/vrmaTestMotions';
import { isKnownMotionSelectionId } from './motionDebug';

export function loadDebugPanelSections(): DebugPanelSectionState {
  if (typeof localStorage === 'undefined') {
    return debugPanelSectionDefaults;
  }

  const saved = localStorage.getItem(DEBUG_PANEL_SECTION_STORAGE_KEY);
  if (!saved) {
    return debugPanelSectionDefaults;
  }

  try {
    const parsed = JSON.parse(saved) as Partial<Record<DebugPanelSectionId, unknown>>;
    return Object.fromEntries(
      (Object.keys(debugPanelSectionDefaults) as DebugPanelSectionId[]).map((key) => [
        key,
        typeof parsed[key] === 'boolean' ? parsed[key] : debugPanelSectionDefaults[key]
      ])
    ) as DebugPanelSectionState;
  } catch {
    return debugPanelSectionDefaults;
  }
}

export function saveDebugPanelSections(sections: DebugPanelSectionState): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(DEBUG_PANEL_SECTION_STORAGE_KEY, JSON.stringify(sections));
}

export function loadGlobalProxyEnabled(): boolean {
  if (typeof localStorage === 'undefined') {
    return false;
  }

  const saved = localStorage.getItem(GLOBAL_PROXY_ENABLED_STORAGE_KEY);
  if (saved !== null) {
    try {
      return JSON.parse(saved) === true;
    } catch {
      return false;
    }
  }

  return false;
}

export function saveGlobalProxyEnabled(enabled: boolean): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(GLOBAL_PROXY_ENABLED_STORAGE_KEY, JSON.stringify(enabled));
  }
}

export function loadGlobalProxyUrl(): string {
  if (typeof localStorage === 'undefined') return DEFAULT_GLOBAL_PROXY_URL;
  return localStorage.getItem(GLOBAL_PROXY_URL_STORAGE_KEY) || DEFAULT_GLOBAL_PROXY_URL;
}

export function saveGlobalProxyUrl(proxyUrl: string): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(GLOBAL_PROXY_URL_STORAGE_KEY, proxyUrl.trim() || DEFAULT_GLOBAL_PROXY_URL);
  }
}

export function loadWebSearchEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(WEB_SEARCH_ENABLED_STORAGE_KEY) === 'true';
}

export function saveWebSearchEnabled(enabled: boolean): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(WEB_SEARCH_ENABLED_STORAGE_KEY, JSON.stringify(enabled));
  }
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

export function loadCharacterRenderPanelOpen(): boolean {
  if (typeof localStorage === 'undefined') {
    return false;
  }

  return localStorage.getItem(CHARACTER_RENDER_PANEL_OPEN_STORAGE_KEY) === 'true';
}

export function saveCharacterRenderPanelOpen(open: boolean): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(CHARACTER_RENDER_PANEL_OPEN_STORAGE_KEY, String(open));
}

export function loadAvatarFitPanelOpen(): boolean {
  if (typeof localStorage === 'undefined') {
    return false;
  }

  return localStorage.getItem(AVATAR_FIT_PANEL_OPEN_STORAGE_KEY) === 'true';
}

export function saveAvatarFitPanelOpen(open: boolean): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(AVATAR_FIT_PANEL_OPEN_STORAGE_KEY, String(open));
}

export function loadVrmModelSelection(): string {
  const fallback = vrmModelOptions[0]?.id ?? '';
  if (typeof localStorage === 'undefined') {
    return fallback;
  }

  const saved = localStorage.getItem(VRM_MODEL_SELECTION_STORAGE_KEY);
  return saved && vrmModelOptions.some((model) => model.id === saved) ? saved : fallback;
}

export function saveVrmModelSelection(modelId: string): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(VRM_MODEL_SELECTION_STORAGE_KEY, modelId);
}

export function loadVrmaMotionTestSelection(): VrmaMotionTestSelection {
  const fallback: VrmaMotionTestSelection = {
    motionId: vrmaManualTestMotions[0]?.id ?? '',
    maskId: vrmaMotionTestMaskOptions[0]?.id ?? 'Full',
    loop: false
  };

  if (typeof localStorage === 'undefined') {
    return fallback;
  }

  const saved = localStorage.getItem(VRMA_MOTION_TEST_SELECTION_STORAGE_KEY);

  if (!saved) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(saved) as Partial<VrmaMotionTestSelection>;
    const savedMotionId = typeof parsed.motionId === 'string' ? parsed.motionId : '';
    const savedMaskId = typeof parsed.maskId === 'string' ? parsed.maskId : '';

    return {
      motionId: isKnownMotionSelectionId(savedMotionId) ? savedMotionId : fallback.motionId,
      maskId: vrmaMotionTestMaskOptions.some((option) => option.id === savedMaskId)
        ? savedMaskId
        : fallback.maskId,
      loop: typeof parsed.loop === 'boolean' ? parsed.loop : fallback.loop
    };
  } catch {
    return fallback;
  }
}

export function saveVrmaMotionTestSelection(selection: VrmaMotionTestSelection): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(VRMA_MOTION_TEST_SELECTION_STORAGE_KEY, JSON.stringify(selection));
}
