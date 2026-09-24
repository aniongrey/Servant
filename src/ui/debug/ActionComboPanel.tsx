import {
  kimodoIdleMotionId,
  type DebugPanelSectionId,
  actionComboExamples,
  actionConfigList,
  actionPresetMap
} from './debugConfig';
import { actionBodyPartOrder } from '../../character/motion/actions/actionBodyParts';
import { type RuntimeSnapshot } from '../../app/runtimeTypes';
import { Sparkles, Play, Square } from 'lucide-react';
import { DebugSection } from './DebugControls';
import { formatActionPartOwner } from './debugFormat';
import type { DebugMotionController } from './useDebugMotionController';

export function ActionComboPanel({
  open,
  onToggle,
  motionTests,
  snapshot
}: {
  open: boolean;
  onToggle: (section: DebugPanelSectionId, open: boolean) => void;
  motionTests: Pick<
    DebugMotionController,
    'armComboTestPhase' | 'playActionExample' | 'playArmComboTest' | 'stopActionComboTest'
  >;
  snapshot: RuntimeSnapshot;
}) {
  const { armComboTestPhase, playActionExample, playArmComboTest, stopActionComboTest } = motionTests;
  return (
    <DebugSection id="actionCombo" onToggle={onToggle} open={open} title="Action Combo V1">
      <div className="buttonGrid motionComboActions">
        {actionComboExamples.map((example) => (
          <button key={example.label} onClick={() => playActionExample(example.actions, example.expression)}>
            <Sparkles size={17} />
            {example.label}
          </button>
        ))}
        <button disabled={!kimodoIdleMotionId} onClick={() => void playArmComboTest()}>
          <Play size={17} />
          Idle → Handback → Pointing
        </button>
        <button onClick={stopActionComboTest}>
          <Square size={17} />
          Stop Actions
        </button>
      </div>
      <div className="comboLogic">
        <div className="comboLogicHeader">
          <Sparkles size={17} />
          <strong>7 Body Parts</strong>
        </div>
        <dl className="comboLayerGrid">
          {actionBodyPartOrder.map((part) => (
            <div key={part}>
              <dt>{part}</dt>
              <dd>{formatActionPartOwner(part, snapshot.action.activeParts)}</dd>
            </div>
          ))}
        </dl>
        <p className="hintText">
          configured actions: {actionConfigList.length} · angry candidates:{' '}
          {actionPresetMap.angry?.actions.join(', ') ?? 'none'}
        </p>
        <p className="hintText">
          arm combo: {armComboTestPhase} · full-body idle loop → handback arms 2s → pointing arms
        </p>
      </div>
    </DebugSection>
  );
}
