import type {
  CharacterRenderBooleanKey,
  CharacterRenderNumberKey
} from '../../character/vrm/characterRenderSettings';

interface LightingField {
  key: CharacterRenderNumberKey;
  label: string;
  min: number;
  max: number;
  step: number;
  sparkle?: boolean;
}

interface LightingGroup {
  label: string;
  toggle: CharacterRenderBooleanKey;
  toggleLabel: string;
  fields: LightingField[];
  extraToggle?: { key: CharacterRenderBooleanKey; label: string };
}

export const lightingGroups: LightingGroup[] = [
  {
    label: 'MToon Shade',
    toggle: 'mtoonShadeEnabled',
    toggleLabel: 'MToon Shade',
    fields: [
      { key: 'shadingShift', label: 'Shade Area', min: -0.5, max: 0.5, step: 0.01 },
      { key: 'shadingToony', label: 'Shade Edge', min: 0, max: 1, step: 0.02 },
      { key: 'shadeStrength', label: 'Shade Dark', min: 0, max: 1, step: 0.02 },
      { key: 'mtoonAoStrength', label: 'AO Strength', min: 0, max: 0.6, step: 0.01 }
    ],
    extraToggle: { key: 'mtoonAoEnabled', label: 'MToon AO' }
  },
  {
    label: 'Main Light',
    toggle: 'rimEnabled',
    toggleLabel: 'Rim Light',
    fields: [
      { key: 'mainLightIntensity', label: 'Main', min: 0.5, max: 4, step: 0.05 },
      { key: 'ambientLightIntensity', label: 'Ambient', min: 0, max: 1.4, step: 0.02 },
      { key: 'rimStrength', label: 'Rim', min: 0, max: 1, step: 0.02, sparkle: true },
      { key: 'rimFresnelPower', label: 'Rim Power', min: 0.8, max: 6, step: 0.1 }
    ]
  },
  {
    label: 'Outline',
    toggle: 'outlineEnabled',
    toggleLabel: 'Outline',
    fields: [
      { key: 'outlineWidth', label: 'Line Width', min: 0, max: 0.015, step: 0.001 },
      { key: 'outlineDarkness', label: 'Line Dark', min: 0, max: 1, step: 0.02 }
    ]
  },
  {
    label: 'Back Shadow',
    toggle: 'backShadowEnabled',
    toggleLabel: 'Back Shadow',
    fields: [
      { key: 'backShadowOffsetX', label: 'Back X', min: -80, max: 80, step: 1 },
      { key: 'backShadowOffsetY', label: 'Back Y', min: -80, max: 80, step: 1 },
      { key: 'backShadowBlur', label: 'Back Blur', min: 0, max: 24, step: 1 },
      { key: 'backShadowOpacity', label: 'Back Alpha', min: 0, max: 0.8, step: 0.02 }
    ]
  },
  {
    label: 'Foot Shadow',
    toggle: 'contactShadowEnabled',
    toggleLabel: 'Foot Shadow',
    fields: [
      { key: 'contactShadowOpacity', label: 'Foot Alpha', min: 0, max: 0.55, step: 0.01 },
      { key: 'contactShadowWidth', label: 'Foot Width', min: 0.2, max: 1.5, step: 0.01 },
      { key: 'contactShadowDepth', label: 'Foot Depth', min: 0.1, max: 1, step: 0.01 },
      { key: 'contactShadowHeightFade', label: 'Height Fade', min: 0, max: 1.5, step: 0.05 }
    ]
  },
  {
    label: 'Hair',
    toggle: 'hairHighlightEnabled',
    toggleLabel: 'Hair Highlight',
    fields: [
      { key: 'hairHighlightStrength', label: 'Hair Shine', min: 0, max: 0.8, step: 0.01, sparkle: true }
    ]
  }
];
