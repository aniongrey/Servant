import {
  defaultCharacterRenderConfig,
  type CharacterRenderConfig
} from '../../character/vrm/CharacterRenderConfig';
import {
  defaultAvatarFitConfig,
  normalizeAvatarFitConfig,
  type AvatarFitConfig
} from '../../character/ik/AvatarFitConfig';
export const TEST_SETTING_KEYS = {
  avatarFit: 'codex-list.avatarFitConfig.v1',
  hold: 'codex-list.holdMicroMotionEnabled.v1',
  footIk: 'codex-list.footIkEnabled.v1',
  render: 'codex-list.characterRenderConfig.v1'
} as const;
function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}
function readBoolean(key: string, fallback: boolean): boolean {
  const value = localStorage.getItem(key);
  return value === null ? fallback : value === 'true';
}
export interface DesktopTestSettings {
  avatarFit: AvatarFitConfig;
  holdMicroMotionEnabled: boolean;
  footIkEnabled: boolean;
  renderConfig: CharacterRenderConfig;
}
export function loadDesktopTestSettings(): DesktopTestSettings {
  const render = readJson(TEST_SETTING_KEYS.render);
  return {
    avatarFit: normalizeAvatarFitConfig(
      readJson(TEST_SETTING_KEYS.avatarFit) as Partial<AvatarFitConfig> | undefined,
      defaultAvatarFitConfig
    ),
    holdMicroMotionEnabled: readBoolean(TEST_SETTING_KEYS.hold, false),
    footIkEnabled: readBoolean(TEST_SETTING_KEYS.footIk, false),
    renderConfig: { ...defaultCharacterRenderConfig, ...(render && typeof render === 'object' ? render : {}) }
  };
}
export interface TestModules {
  avatarFit: boolean;
  hold: boolean;
  footIk: boolean;
  handIk: boolean;
  lighting: boolean;
}
export function withTestModules(settings: DesktopTestSettings, modules: TestModules): DesktopTestSettings {
  return {
    ...settings,
    avatarFit: {
      ...settings.avatarFit,
      handIk: {
        ...settings.avatarFit.handIk,
        enabled: modules.avatarFit && modules.handIk && settings.avatarFit.handIk.enabled
      }
    },
    holdMicroMotionEnabled: modules.hold,
    footIkEnabled: modules.footIk,
    renderConfig: modules.lighting
      ? settings.renderConfig
      : { ...settings.renderConfig, mainLightIntensity: 0, ambientLightIntensity: 0, rimStrength: 0 }
  };
}
