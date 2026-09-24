import {
  vrmaMotionTestMaskOptions,
  vrmaManualTestMotions
} from '../../character/motion/assets/vrmaTestMotions';
import { vrmModelOptions } from '../../character/vrm/assets/vrmModels';
import { editableActionConfigs, type DebugPanelSectionId } from './debugConfig';
import { roundMotionTime, formatSeconds, formatPhaseConfigSaveStatus } from './motionDebug';
import { type RuntimeSnapshot } from '../../app/runtimeTypes';
import { SlidersHorizontal, Play, Square, Pause, Save } from 'lucide-react';
import { DebugSection, PreciseRenderSlider, MotionPhaseCutControl } from './DebugControls';
import type { DebugCharacterSettings } from './useDebugCharacterSettings';
import type { DebugMotionController } from './useDebugMotionController';

export function MotionTestPanel({
  open,
  onToggle,
  characterSettings,
  motionTests,

  snapshot
}: {
  open: boolean;
  onToggle: (section: DebugPanelSectionId, open: boolean) => void;
  characterSettings: Pick<
    DebugCharacterSettings,
    'setSelectedVrmModelId' | 'selectedVrmModel' | 'frontPushMinHeight' | 'updateHandIkRule'
  >;
  motionTests: Pick<
    DebugMotionController,
    | 'testMotionId'
    | 'setTestMotionId'
    | 'testMotionMaskId'
    | 'setTestMotionMaskId'
    | 'testMotionLoop'
    | 'setTestMotionLoop'
    | 'testMotionPaused'
    | 'testActionId'
    | 'setTestActionId'
    | 'testMotionDuration'
    | 'testMotionPhaseCuts'
    | 'phaseConfigSaveStatus'
    | 'vrmaMotionSelectOptions'
    | 'selectedTestMotionOption'
    | 'selectedTestMotionMask'
    | 'selectedTestAction'
    | 'playTestMotion'
    | 'toggleTestMotionPaused'
    | 'stopTestMotion'
    | 'updateMotionPhaseCut'
    | 'saveMotionPhaseConfig'
    | 'playTestMotionPhase'
  >;

  snapshot: RuntimeSnapshot;
}) {
  const { setSelectedVrmModelId, selectedVrmModel, frontPushMinHeight, updateHandIkRule } = characterSettings;
  const {
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
    vrmaMotionSelectOptions,
    selectedTestMotionOption,
    selectedTestMotionMask,
    selectedTestAction,
    playTestMotion,
    toggleTestMotionPaused,
    stopTestMotion,
    updateMotionPhaseCut,
    saveMotionPhaseConfig,
    playTestMotionPhase
  } = motionTests;

  return (
    <DebugSection id="vrmaMotionTest" onToggle={onToggle} open={open} title="VRMA Motion Test">
      <div className="renderSettingGroup motionTestIkTop">
        <PreciseRenderSlider
          icon={<SlidersHorizontal size={16} />}
          label="Front Y"
          min={0}
          max={1.6}
          step={0.005}
          value={frontPushMinHeight}
          onChange={(value) => updateHandIkRule('frontPushMinHeight', value)}
        />
      </div>
      <div className="inlineControl modelSelector">
        <select
          value={selectedVrmModel.id}
          onChange={(event) => setSelectedVrmModelId(event.currentTarget.value)}
        >
          {vrmModelOptions.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
      </div>
      <div className="inlineControl testMotionSelectors">
        <select value={testMotionId} onChange={(event) => setTestMotionId(event.currentTarget.value)}>
          {vrmaMotionSelectOptions.map((motion) => (
            <option key={motion.id} value={motion.id}>
              {motion.label}
            </option>
          ))}
        </select>
        <select value={testMotionMaskId} onChange={(event) => setTestMotionMaskId(event.currentTarget.value)}>
          {vrmaMotionTestMaskOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <button disabled={!selectedTestMotionOption} onClick={playTestMotion}>
          <Play size={17} />
          Play
        </button>
      </div>
      <div className="testMotionControls">
        <label>
          <input
            checked={testMotionLoop}
            onChange={(event) => setTestMotionLoop(event.currentTarget.checked)}
            type="checkbox"
          />
          Loop
        </label>
        <button onClick={stopTestMotion}>
          <Square size={17} />
          Stop
        </button>
        <button disabled={!snapshot.body.currentAction} onClick={toggleTestMotionPaused}>
          {testMotionPaused ? <Play size={17} /> : <Pause size={17} />}
          {testMotionPaused ? 'Resume' : 'Pause'}
        </button>
      </div>
      <div className="motionPhaseEditor">
        <div className="motionPhaseHeader">
          <strong>Enter / Hold / Exit</strong>
          <span>Total {formatSeconds(testMotionDuration)}s</span>
        </div>
        <label className="motionPhaseActionRow">
          <span>Action</span>
          <select value={testActionId} onChange={(event) => setTestActionId(event.currentTarget.value)}>
            {editableActionConfigs.map((action) => (
              <option key={action.id} value={action.id}>
                {action.id}
              </option>
            ))}
          </select>
        </label>
        <MotionPhaseCutControl
          label="Enter → Hold"
          max={testMotionDuration}
          value={testMotionPhaseCuts.enterEnd}
          onChange={(value) => updateMotionPhaseCut('enterEnd', value)}
        />
        <MotionPhaseCutControl
          label="Hold → Exit"
          max={testMotionDuration}
          value={testMotionPhaseCuts.holdEnd}
          onChange={(value) => updateMotionPhaseCut('holdEnd', value)}
        />
        <div className="motionPhasePreview">
          {(['enter', 'hold', 'exit'] as const).map((phase) => (
            <button key={phase} onClick={() => playTestMotionPhase(phase)} type="button">
              <Play size={15} />
              {phase}
            </button>
          ))}
          <button
            className="savePhaseConfigButton"
            disabled={!selectedTestAction || phaseConfigSaveStatus === 'saving'}
            onClick={() => void saveMotionPhaseConfig()}
            type="button"
          >
            <Save size={15} />
            {formatPhaseConfigSaveStatus(phaseConfigSaveStatus)}
          </button>
        </div>
        <code className="motionPhaseConfigPreview">
          {`"split": ${JSON.stringify([
            roundMotionTime(testMotionPhaseCuts.enterEnd),
            roundMotionTime(testMotionPhaseCuts.holdEnd)
          ])}`}
        </code>
      </div>
      <p className="hintText">
        Model {selectedVrmModel.label} · scanned {vrmModelOptions.length} models from /assets/character
      </p>
      <p className="hintText">
        Scanned {vrmaManualTestMotions.length} motions · mask {selectedTestMotionMask?.label ?? 'Full Body'}
        {selectedTestMotionMask?.boneCount ? ` / ${selectedTestMotionMask.boneCount} bones` : ' / all tracks'}
      </p>
      <p className="hintText">Hand IK is applied automatically to every motion containing arm tracks.</p>
    </DebugSection>
  );
}
