import {
  type RuntimeSnapshot,
  type ActionBodyPart,
  type ActionConfig,
  type EmotionActionPresetMap
} from '../../app/runtimeTypes';
import type { SoulState } from '../../soul';
import actionConfigs from '../../character/motion/assets/actions/action-configs.json';
import fullBodyMotionConfig from '../../character/motion/assets/actions/full-body-motion-config.json';
import { VRMA_IDLE_CLIP_NAME } from '../../character/motion/assets/vrmaAssetFiles';
import { vrmaManualTestMotions } from '../../character/motion/assets/vrmaTestMotions';
import { type SpeechSdkTtsLanguage } from '../../ai/tts/speechSdkTypes';

export const emotionLabels: Record<keyof RuntimeSnapshot['emotions'], string> = {
  anger: 'Anger',
  sadness: 'Sadness',
  happiness: 'Happiness',
  shyness: 'Shyness'
};

export const relationshipLabels: Record<keyof RuntimeSnapshot['relationship'], string> = {
  trust: 'Trust',
  attachment: 'Attachment'
};

export const characterRelationshipLabels: Record<keyof SoulState['relation'], string> = {
  intimacy: 'Intimacy',
  trust: 'Trust'
};

export const characterEmotionLabels: Record<keyof SoulState['mood'], string> = {
  happiness: 'Happiness',
  anger: 'Anger',
  sadness: 'Sadness'
};

export const QUICK_CUSTOM_TRIGGER_COOLDOWN_MS = 750;

export type DebugPanelSectionId =
  | 'vrmaMotionTest'
  | 'triggers'
  | 'actionCombo'
  | 'director'
  | 'input'
  | 'runtimeEmotion'
  | 'runtimeRelationship'
  | 'characterState'
  | 'customTriggers'
  | 'runtime'
  | 'log';

export type DebugPanelSectionState = Record<DebugPanelSectionId, boolean>;

export const debugPanelSectionDefaults: DebugPanelSectionState = {
  vrmaMotionTest: true,
  triggers: true,
  actionCombo: true,
  director: true,
  input: true,
  runtimeEmotion: true,
  runtimeRelationship: true,
  characterState: true,
  customTriggers: true,
  runtime: true,
  log: true
};

export interface VrmaMotionPhaseConfig {
  duration: number;
  enterEnd: number;
  holdEnd: number;
}

export type VrmaMotionPhase = 'enter' | 'hold' | 'exit';

export type PhaseConfigSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type ArmComboTestPhase = 'stopped' | 'idle' | 'handback' | 'pointing';

export type RandomComboMode = 'full' | 'hold';

export interface RandomComboPartSelection {
  motionId: string;
  mode: RandomComboMode;
  durationSeconds: string;
}

export type RandomComboSelections = Record<ActionBodyPart, RandomComboPartSelection>;

export interface VrmaMotionTestSelection {
  motionId: string;
  maskId: string;
  loop: boolean;
}

export interface VrmaMotionSelectOption {
  id: string;
  sourceMotionId: string;
  label: string;
}

export type AvatarFitNumberKey = 'height' | 'shoulderWidth' | 'armLength' | 'footGroundOffset';

export const actionConfigList = actionConfigs as ActionConfig[];

export const editableActionConfigs = actionConfigList.filter((action) => !action.oneShot);

/** 组合动作 id → 预设，直接来自 full-body-motion-config.json，与运行时的 ActionLoader 同源。 */
export const actionPresetMap = Object.fromEntries(
  Object.keys(fullBodyMotionConfig.emotion).map((id) => [id, { actions: [id] }])
) as EmotionActionPresetMap;

export const kimodoIdleMotionId = vrmaManualTestMotions.find((motion) =>
  motion.url.toLowerCase().endsWith(`/${VRMA_IDLE_CLIP_NAME}`)
)?.id;

export const fallbackComboMotionId = kimodoIdleMotionId ?? vrmaManualTestMotions[0]?.id ?? '';

export const actionComboExamples = [
  {
    label: '叉腰 + 扭头',
    actions: ['hands_on_hips', 'turn_head'],
    expression: 'angry'
  },
  {
    label: '叉腰 + 跺脚',
    actions: ['hands_on_hips', 'stomp'],
    expression: 'angry'
  },
  {
    label: '抱胸 + 扭头',
    actions: ['cross_arms', 'turn_head'],
    expression: 'angry'
  },
  {
    label: '捂脸 + 摇头',
    actions: ['cover_face', 'shake_head'],
    expression: 'blush'
  }
];

export const speechSdkTtsLanguageOptions: Array<{ id: SpeechSdkTtsLanguage; label: string }> = [
  { id: 'zh', label: '汉语' },
  { id: 'ja', label: '日语' },
  { id: 'en', label: '英语' },
  { id: 'ko', label: '韩语' }
];
