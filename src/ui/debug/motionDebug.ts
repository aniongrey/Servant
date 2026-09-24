import {
  RANDOM_COMBO_SELECTIONS_STORAGE_KEY,
  HOLD_MICRO_MOTION_ENABLED_STORAGE_KEY,
  FOOT_IK_ENABLED_STORAGE_KEY
} from '../../app/settings/storageKeys';
import {
  type VrmaMotionSelectOption,
  type RandomComboSelections,
  fallbackComboMotionId,
  type RandomComboPartSelection,
  type RandomComboMode,
  actionConfigList,
  kimodoIdleMotionId,
  type VrmaMotionPhaseConfig,
  type VrmaMotionPhase,
  type PhaseConfigSaveStatus
} from './debugConfig';
import {
  vrmaManualTestMotions,
  resolveVrmaManualTestMotionId
} from '../../character/motion/assets/vrmaTestMotions';
import { actionBodyPartOrder, toConfigId } from '../../character/motion/actions/actionBodyParts';
import { type ActionBodyPart, type MotionMeta, type ActionConfig } from '../../app/runtimeTypes';
import { type AgentRuntime } from '../../ai/AgentRuntime';
import { delay } from '../../app/utils/delay';

export function createVrmaMotionSelectOptions(): VrmaMotionSelectOption[] {
  return vrmaManualTestMotions.map((motion) => ({
    id: motion.id,
    sourceMotionId: motion.id,
    label: motion.url.split('/').at(-1) ?? motion.id
  }));
}

function createDefaultRandomComboSelections(): RandomComboSelections {
  return Object.fromEntries(
    actionBodyPartOrder.map((part) => [
      part,
      {
        motionId: fallbackComboMotionId,
        mode: 'full',
        durationSeconds: ''
      } satisfies RandomComboPartSelection
    ])
  ) as RandomComboSelections;
}

export function loadRandomComboSelections(): RandomComboSelections {
  const fallback = createDefaultRandomComboSelections();
  if (typeof localStorage === 'undefined') {
    return fallback;
  }

  const saved = localStorage.getItem(RANDOM_COMBO_SELECTIONS_STORAGE_KEY);
  if (!saved) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(saved) as Partial<Record<ActionBodyPart, Partial<RandomComboPartSelection>>>;
    return Object.fromEntries(
      actionBodyPartOrder.map((part) => {
        const candidate = parsed[part];
        const motionId =
          typeof candidate?.motionId === 'string' && findManualTestMotion(candidate.motionId)
            ? candidate.motionId
            : fallback[part].motionId;
        const motion = findManualTestMotion(motionId);
        const holdAvailable = Boolean(motion && findConfiguredActionForMotion(motion)?.split);
        const mode: RandomComboMode = candidate?.mode === 'hold' && holdAvailable ? 'hold' : 'full';
        const durationSeconds =
          mode === 'hold' && typeof candidate?.durationSeconds === 'string' ? candidate.durationSeconds : '';
        return [part, { motionId, mode, durationSeconds } satisfies RandomComboPartSelection];
      })
    ) as RandomComboSelections;
  } catch {
    return fallback;
  }
}

export function saveRandomComboSelections(selections: RandomComboSelections): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(RANDOM_COMBO_SELECTIONS_STORAGE_KEY, JSON.stringify(selections));
}

export function loadHoldMicroMotionEnabled(): boolean {
  if (typeof localStorage === 'undefined') {
    return true;
  }

  const saved = localStorage.getItem(HOLD_MICRO_MOTION_ENABLED_STORAGE_KEY);
  return saved === null ? true : saved === 'true';
}

export function saveHoldMicroMotionEnabled(enabled: boolean): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(HOLD_MICRO_MOTION_ENABLED_STORAGE_KEY, String(enabled));
}

export function loadFootIkEnabled(): boolean {
  if (typeof localStorage === 'undefined') {
    return true;
  }

  const saved = localStorage.getItem(FOOT_IK_ENABLED_STORAGE_KEY);
  return saved === null ? true : saved === 'true';
}

export function saveFootIkEnabled(enabled: boolean): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(FOOT_IK_ENABLED_STORAGE_KEY, String(enabled));
}

export function createRandomComboSelections(): RandomComboSelections {
  const motions = vrmaManualTestMotions.length > 0 ? vrmaManualTestMotions : [];
  return Object.fromEntries(
    actionBodyPartOrder.map((part) => {
      const motion = motions[Math.floor(Math.random() * motions.length)];
      const action = motion ? findConfiguredActionForMotion(motion) : undefined;
      const mode: RandomComboMode = action?.split && Math.random() < 0.5 ? 'hold' : 'full';
      return [
        part,
        {
          motionId: motion?.id ?? fallbackComboMotionId,
          mode,
          durationSeconds: mode === 'hold' ? '2' : ''
        } satisfies RandomComboPartSelection
      ];
    })
  ) as RandomComboSelections;
}

export function findManualTestMotion(motionId: string): MotionMeta | undefined {
  return vrmaManualTestMotions.find((motion) => motion.id === motionId);
}

export function findConfiguredActionForMotion(motion: MotionMeta): ActionConfig | undefined {
  const motionKey = motion.id.replace(/^vrma_test_/, '');
  return actionConfigList.find((action) => {
    const configuredPath = action.vrma
      .replace(/\\/g, '/')
      .replace(/^\/?VRMA\//i, '')
      .replace(/\.vrma$/i, '');
    const configuredPathKey = toConfigId(configuredPath);
    const configuredName = toConfigId(configuredPath.split('/').at(-1) ?? configuredPath);
    return configuredPathKey === motionKey && configuredName === toConfigId(action.id);
  });
}

export function formatComboMotionLabel(motion: MotionMeta): string {
  return decodeURIComponent(motion.url.split('/').at(-1) ?? motion.id).replace(/\?.*$/, '');
}

export function registerRandomComboMotion(
  engine: AgentRuntime,
  source: MotionMeta,
  part: ActionBodyPart,
  holdAction?: ActionConfig
): string {
  const holdRange = holdAction?.split;
  const mode: RandomComboMode = holdRange ? 'hold' : 'full';
  const id = `random_combo__${toConfigId(part)}__${source.id}__${mode}`;
  engine.registry.register({
    ...source,
    id,
    layer: part,
    mask: part,
    loop: 'repeat',
    trimStartSeconds: holdRange?.[0],
    trimEndSeconds: holdRange?.[1],
    defaultFadeIn: 0.2,
    defaultFadeOut: 0.2,
    returnToIdle: false,
    durationMs: holdRange ? Math.max(1, Math.round((holdRange[1] - holdRange[0]) * 1000)) : source.durationMs,
    tags: [...source.tags, 'random-combo', `part:${part}`, ...(holdRange ? ['phase:hold'] : ['phase:full'])]
  });
  return id;
}

export async function returnRandomComboPartToIdle(
  engine: AgentRuntime,
  part: ActionBodyPart,
  durationSeconds: number,
  runId: number,
  runRef: { current: number }
): Promise<void> {
  await delay(durationSeconds * 1000);
  if (runRef.current !== runId || !kimodoIdleMotionId) {
    return;
  }

  engine.actions.playMotion(resolveVrmaManualTestMotionId(kimodoIdleMotionId, part), {
    loop: 'repeat',
    layer: part,
    mask: part,
    returnToIdle: false
  });
}

export function playMotionLayers(
  engine: AgentRuntime,
  parts: readonly ActionBodyPart[],
  resolveMotionId: (part: ActionBodyPart) => string
): void {
  parts.forEach((part) => {
    engine.actions.playMotion(resolveMotionId(part), {
      loop: 'repeat',
      layer: part,
      mask: part,
      returnToIdle: false
    });
  });
}

export function isKnownMotionSelectionId(selectionId: string): boolean {
  return Boolean(selectionId) && vrmaManualTestMotions.some((motion) => motion.id === selectionId);
}

export function createDefaultMotionPhaseConfig(duration: number): VrmaMotionPhaseConfig {
  const safeDuration = Math.max(0.03, duration);
  return {
    duration: safeDuration,
    enterEnd: safeDuration / 3,
    holdEnd: (safeDuration * 2) / 3
  };
}

export function normalizeMotionPhaseConfig(
  config: Partial<VrmaMotionPhaseConfig> | undefined,
  duration: number
): VrmaMotionPhaseConfig {
  const safeDuration = Math.max(0.03, Number.isFinite(duration) ? duration : 1.2);
  const minimumSegment = Math.min(0.01, safeDuration / 3);
  const defaultConfig = createDefaultMotionPhaseConfig(safeDuration);
  const rawEnterEnd = Number.isFinite(config?.enterEnd) ? Number(config?.enterEnd) : defaultConfig.enterEnd;
  const enterEnd = Math.min(safeDuration - minimumSegment * 2, Math.max(minimumSegment, rawEnterEnd));
  const rawHoldEnd = Number.isFinite(config?.holdEnd) ? Number(config?.holdEnd) : defaultConfig.holdEnd;
  const holdEnd = Math.min(safeDuration - minimumSegment, Math.max(enterEnd + minimumSegment, rawHoldEnd));

  return { duration: safeDuration, enterEnd, holdEnd };
}

export function getMotionPhaseRange(
  config: VrmaMotionPhaseConfig,
  phase: VrmaMotionPhase
): { start: number; end: number } {
  if (phase === 'enter') {
    return { start: 0, end: config.enterEnd };
  }
  if (phase === 'hold') {
    return { start: config.enterEnd, end: config.holdEnd };
  }
  return { start: config.holdEnd, end: config.duration };
}

export function roundMotionTime(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function formatSeconds(value: number): string {
  return roundMotionTime(value).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatPhaseConfigSaveStatus(status: PhaseConfigSaveStatus): string {
  if (status === 'saving') {
    return 'Saving...';
  }
  if (status === 'saved') {
    return 'Saved to JSON';
  }
  if (status === 'error') {
    return 'Save failed';
  }
  return 'Save config';
}
