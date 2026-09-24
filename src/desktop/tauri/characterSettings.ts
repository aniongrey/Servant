import type { AvatarFitConfig } from '../../character/ik/AvatarFitConfig.ts';
import type { CharacterRenderConfig } from '../../character/vrm/CharacterRenderConfig.ts';
import type { CharacterProportionConfig } from '../../character/vrm/CharacterProportion.ts';

export interface DesktopCharacterSettings {
  version: 1;
  model: { id: string; asset?: string };
  avatarFit: AvatarFitConfig;
  renderConfig: CharacterRenderConfig;
  proportionConfig: CharacterProportionConfig;
  holdMicroMotionEnabled: boolean;
  footIkEnabled: boolean;
}

export function isDesktopCharacterSettings(value: unknown): value is DesktopCharacterSettings {
  if (!value || typeof value !== 'object') return false;
  const config = value as DesktopCharacterSettings;
  return (
    config.version === 1 &&
    typeof config.model?.id === 'string' &&
    (config.model.asset === undefined ||
      /^\/api\/desktop-character\/models\/[a-f0-9]{64}$/.test(config.model.asset)) &&
    !!config.avatarFit &&
    typeof config.avatarFit === 'object' &&
    !!config.renderConfig &&
    typeof config.renderConfig === 'object' &&
    (config.proportionConfig === undefined ||
      (!!config.proportionConfig && typeof config.proportionConfig === 'object')) &&
    typeof config.holdMicroMotionEnabled === 'boolean' &&
    typeof config.footIkEnabled === 'boolean'
  );
}
