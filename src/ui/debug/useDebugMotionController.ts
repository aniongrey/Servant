import { useState, useMemo, useRef, useEffect } from 'react';
import { loadVrmaMotionTestSelection, saveVrmaMotionTestSelection } from './debugSettings';
import { type AgentRuntime } from '../../ai/AgentRuntime';
import {
  vrmaMotionTestMaskOptions,
  vrmaManualTestMotions,
  resolveVrmaManualTestMotionId
} from '../../character/motion/assets/vrmaTestMotions';
import {
  editableActionConfigs,
  type PhaseConfigSaveStatus,
  type ArmComboTestPhase,
  type RandomComboSelections,
  kimodoIdleMotionId,
  type RandomComboPartSelection,
  type VrmaMotionPhase
} from './debugConfig';
import {
  createDefaultMotionPhaseConfig,
  loadRandomComboSelections,
  createVrmaMotionSelectOptions,
  saveRandomComboSelections,
  normalizeMotionPhaseConfig,
  playMotionLayers,
  createRandomComboSelections,
  findManualTestMotion,
  findConfiguredActionForMotion,
  registerRandomComboMotion,
  returnRandomComboPartToIdle,
  roundMotionTime,
  getMotionPhaseRange
} from './motionDebug';
import { delay } from '../../app/utils/delay';
import { actionBodyPartOrder } from '../../character/motion/actions/actionBodyParts';
import { actionMotionId } from '../../character/motion/actions/ActionLoader';
import { type ActionBodyPart } from '../../app/runtimeTypes';

export function useDebugMotionController(
  engine: AgentRuntime,
  stageMode: 'mock' | 'vrm',
  networkFetch: typeof globalThis.fetch
) {
  const initialVrmaMotionTestSelection = useMemo(loadVrmaMotionTestSelection, []);

  const [testMotionId, setTestMotionId] = useState(initialVrmaMotionTestSelection.motionId);

  const [testMotionMaskId, setTestMotionMaskId] = useState(initialVrmaMotionTestSelection.maskId);

  const [testMotionLoop, setTestMotionLoop] = useState(initialVrmaMotionTestSelection.loop);

  const [testMotionPaused, setTestMotionPaused] = useState(false);

  const [testActionId, setTestActionId] = useState(editableActionConfigs[0]?.id ?? '');

  const [testMotionDuration, setTestMotionDuration] = useState(1.2);

  const [testMotionPhaseCuts, setTestMotionPhaseCuts] = useState(() => createDefaultMotionPhaseConfig(1.2));

  const [phaseConfigSaveStatus, setPhaseConfigSaveStatus] = useState<PhaseConfigSaveStatus>('idle');

  const [armComboTestPhase, setArmComboTestPhase] = useState<ArmComboTestPhase>('stopped');

  const armComboTestRunRef = useRef(0);

  const [randomComboOpen, setRandomComboOpen] = useState(false);

  const [randomComboSelections, setRandomComboSelections] =
    useState<RandomComboSelections>(loadRandomComboSelections);

  const randomComboRunRef = useRef(0);

  const saveRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setArmComboTestPhase('stopped');
    setTestMotionPaused(false);
    return () => {
      // Outstanding delays belong to the previous model, including per-part idle restores.
      armComboTestRunRef.current += 1;
      randomComboRunRef.current += 1;
    };
  }, [engine]);

  useEffect(() => () => saveRequestRef.current?.abort(), [engine, testActionId]);

  const vrmaMotionSelectOptions = useMemo(createVrmaMotionSelectOptions, []);

  const selectedTestMotionOption =
    vrmaMotionSelectOptions.find((option) => option.id === testMotionId) ?? vrmaMotionSelectOptions[0];

  const selectedTestMotionMask =
    vrmaMotionTestMaskOptions.find((option) => option.id === testMotionMaskId) ??
    vrmaMotionTestMaskOptions[0];

  const selectedTestAction = editableActionConfigs.find((action) => action.id === testActionId);

  useEffect(() => {
    saveVrmaMotionTestSelection({
      motionId: testMotionId,
      maskId: testMotionMaskId,
      loop: testMotionLoop
    });
  }, [testMotionId, testMotionMaskId, testMotionLoop]);

  useEffect(() => {
    saveRandomComboSelections(randomComboSelections);
  }, [randomComboSelections]);

  useEffect(() => {
    const configId = selectedTestMotionOption?.sourceMotionId;
    if (!configId) {
      return undefined;
    }

    let cancelled = false;
    const configuredSplit = selectedTestAction?.split;
    const initialConfig = normalizeMotionPhaseConfig(
      configuredSplit ? { enterEnd: configuredSplit[0], holdEnd: configuredSplit[1] } : undefined,
      Math.max(1.2, configuredSplit?.[1] ?? 0)
    );
    setTestMotionDuration(initialConfig.duration);
    setTestMotionPhaseCuts(initialConfig);
    setPhaseConfigSaveStatus('idle');

    const sourceMotion = vrmaManualTestMotions.find((motion) => motion.id === configId);
    if (!sourceMotion || stageMode !== 'vrm') {
      return () => {
        cancelled = true;
      };
    }

    void engine.registry
      .preload(sourceMotion.id)
      .then((loaded) => {
        const duration = loaded.clip?.duration;
        if (cancelled || !duration || !Number.isFinite(duration)) {
          return;
        }

        const nextConfig = configuredSplit
          ? normalizeMotionPhaseConfig(
              { enterEnd: configuredSplit[0], holdEnd: configuredSplit[1] },
              duration
            )
          : createDefaultMotionPhaseConfig(duration);
        setTestMotionDuration(duration);
        setTestMotionPhaseCuts(nextConfig);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [engine, selectedTestAction, selectedTestMotionOption?.sourceMotionId, stageMode]);

  const playTestMotion = () => {
    if (!selectedTestMotionOption) {
      return;
    }

    const sourceMotionId = resolveVrmaManualTestMotionId(
      selectedTestMotionOption.sourceMotionId,
      testMotionMaskId
    );
    const motionId = sourceMotionId;

    setTestMotionPaused(false);
    engine.actions.setMotionPaused(false);
    engine.actions.playMotion(motionId, {
      loop: testMotionLoop ? 'repeat' : 'once',
      returnToIdle: false
    });
  };

  const toggleTestMotionPaused = () => {
    const nextPaused = !testMotionPaused;
    setTestMotionPaused(nextPaused);
    engine.actions.setMotionPaused(nextPaused);
  };

  const stopTestMotion = () => {
    setTestMotionPaused(false);
    engine.actions.stopMotion();
  };

  const playArmComboTest = async () => {
    const idleMotionId = kimodoIdleMotionId;
    if (!idleMotionId) {
      return;
    }

    const runId = armComboTestRunRef.current + 1;
    armComboTestRunRef.current = runId;
    randomComboRunRef.current += 1;
    engine.actions.stopActions(0);
    engine.actions.stopMotion(0);
    await delay(20);
    if (armComboTestRunRef.current !== runId) {
      return;
    }

    setArmComboTestPhase('idle');
    playMotionLayers(engine, actionBodyPartOrder, (part) =>
      resolveVrmaManualTestMotionId(idleMotionId, part)
    );
    await delay(1000);
    if (armComboTestRunRef.current !== runId) {
      return;
    }

    setArmComboTestPhase('handback');
    playMotionLayers(engine, ['LeftArm', 'RightArm'], () => actionMotionId('kimodo_handback2'));
    await delay(2000);
    if (armComboTestRunRef.current !== runId) {
      return;
    }

    setArmComboTestPhase('pointing');
    playMotionLayers(engine, ['LeftArm', 'RightArm'], () => actionMotionId('pointing'));
  };

  const stopActionComboTest = () => {
    armComboTestRunRef.current += 1;
    randomComboRunRef.current += 1;
    setArmComboTestPhase('stopped');
    engine.actions.stopActions();
    engine.actions.stopMotion();
  };

  const playActionExample = (actions: string[], expression: string) => {
    armComboTestRunRef.current += 1;
    randomComboRunRef.current += 1;
    setArmComboTestPhase('stopped');
    engine.actions.playActions(actions, expression);
  };

  const randomizeMotionCombo = () => {
    setRandomComboSelections(createRandomComboSelections());
    setRandomComboOpen(true);
  };

  const updateRandomComboSelection = (part: ActionBodyPart, patch: Partial<RandomComboPartSelection>) => {
    setRandomComboSelections((current) => {
      const nextSelection = { ...current[part], ...patch };
      const motion = findManualTestMotion(nextSelection.motionId);
      if (!motion || !findConfiguredActionForMotion(motion)) {
        nextSelection.mode = 'full';
        nextSelection.durationSeconds = '';
      } else if (nextSelection.mode === 'full') {
        nextSelection.durationSeconds = '';
      }

      return { ...current, [part]: nextSelection };
    });
  };

  const playRandomMotionCombo = async () => {
    const runId = randomComboRunRef.current + 1;
    randomComboRunRef.current = runId;
    armComboTestRunRef.current += 1;
    setArmComboTestPhase('stopped');
    engine.actions.stopActions(0);
    engine.actions.stopMotion(0);
    await delay(20);
    if (randomComboRunRef.current !== runId) {
      return;
    }

    for (const part of actionBodyPartOrder) {
      const selection = randomComboSelections[part];
      const motion = findManualTestMotion(selection.motionId);
      if (!motion) {
        continue;
      }

      const action = findConfiguredActionForMotion(motion);
      const holdEnabled = selection.mode === 'hold' && Boolean(action?.split);
      const motionId = registerRandomComboMotion(engine, motion, part, holdEnabled ? action : undefined);
      engine.actions.playMotion(motionId, {
        loop: 'repeat',
        layer: part,
        mask: part,
        returnToIdle: false
      });

      const durationSeconds = holdEnabled ? Number(selection.durationSeconds) : 0;
      if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
        void returnRandomComboPartToIdle(engine, part, durationSeconds, runId, randomComboRunRef);
      }
    }
  };

  const stopRandomMotionCombo = () => {
    randomComboRunRef.current += 1;
    engine.actions.stopMotion();
  };

  const updateMotionPhaseCut = (key: 'enterEnd' | 'holdEnd', value: number) => {
    saveRequestRef.current?.abort();
    setTestMotionPhaseCuts((current) =>
      normalizeMotionPhaseConfig({ ...current, [key]: value }, testMotionDuration)
    );
    setPhaseConfigSaveStatus('idle');
  };

  const saveMotionPhaseConfig = async () => {
    if (!selectedTestAction) {
      return;
    }

    const config = normalizeMotionPhaseConfig(testMotionPhaseCuts, testMotionDuration);
    const split: [number, number] = [roundMotionTime(config.enterEnd), roundMotionTime(config.holdEnd)];
    setTestMotionPhaseCuts(config);
    setPhaseConfigSaveStatus('saving');
    saveRequestRef.current?.abort();
    const controller = new AbortController();
    saveRequestRef.current = controller;

    try {
      const response = await networkFetch(
        `/api/action-configs/${encodeURIComponent(selectedTestAction.id)}`,
        {
          method: 'PUT',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ split })
        }
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Save failed (${response.status})`);
      }
      if (!controller.signal.aborted) setPhaseConfigSaveStatus('saved');
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error('Failed to save action split config.', error);
      setPhaseConfigSaveStatus('error');
    }
  };

  const playTestMotionPhase = (phase: VrmaMotionPhase) => {
    if (!selectedTestMotionOption) {
      return;
    }

    const sourceMotionId = resolveVrmaManualTestMotionId(
      selectedTestMotionOption.sourceMotionId,
      testMotionMaskId
    );
    const motionId = sourceMotionId;
    const config = normalizeMotionPhaseConfig(testMotionPhaseCuts, testMotionDuration);
    const range = getMotionPhaseRange(config, phase);
    const phaseMotionId = `${motionId}__preview_${phase}`;
    const sourceMeta = engine.registry.get(motionId);

    engine.registry.register({
      ...sourceMeta,
      id: phaseMotionId,
      trimStartSeconds: range.start,
      trimEndSeconds: range.end,
      loop: phase === 'hold' ? 'repeat' : 'once',
      durationMs: Math.max(1, Math.round((range.end - range.start) * 1000)),
      tags: [...sourceMeta.tags, 'phase-preview', `phase:${phase}`]
    });
    setTestMotionPaused(false);
    engine.actions.setMotionPaused(false);
    engine.actions.playMotion(phaseMotionId, {
      loop: phase === 'hold' ? 'repeat' : 'once',
      returnToIdle: false
    });
  };

  return {
    testMotionId,
    setTestMotionId,
    testMotionMaskId,
    setTestMotionMaskId,
    testMotionLoop,
    setTestMotionLoop,
    testMotionPaused,
    testActionId,
    setTestActionId,
    testMotionDuration,
    testMotionPhaseCuts,
    phaseConfigSaveStatus,
    armComboTestPhase,
    randomComboOpen,
    setRandomComboOpen,
    randomComboSelections,
    vrmaMotionSelectOptions,
    selectedTestMotionOption,
    selectedTestMotionMask,
    selectedTestAction,
    playTestMotion,
    toggleTestMotionPaused,
    stopTestMotion,
    playArmComboTest,
    stopActionComboTest,
    playActionExample,
    randomizeMotionCombo,
    updateRandomComboSelection,
    playRandomMotionCombo,
    stopRandomMotionCombo,
    updateMotionPhaseCut,
    saveMotionPhaseConfig,
    playTestMotionPhase
  };
}

export type DebugMotionController = ReturnType<typeof useDebugMotionController>;
