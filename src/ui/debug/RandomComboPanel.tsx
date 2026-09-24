import { vrmaManualTestMotions } from '../../character/motion/assets/vrmaTestMotions';
import { type RandomComboMode } from './debugConfig';
import { findManualTestMotion, findConfiguredActionForMotion, formatComboMotionLabel } from './motionDebug';
import { actionBodyPartOrder } from '../../character/motion/actions/actionBodyParts';
import { Sparkles, Play, Square, ChevronDown } from 'lucide-react';
import type { DebugMotionController } from './useDebugMotionController';

export function RandomComboPanel({
  motionTests
}: {
  motionTests: Pick<
    DebugMotionController,
    | 'randomComboOpen'
    | 'setRandomComboOpen'
    | 'randomComboSelections'
    | 'randomizeMotionCombo'
    | 'updateRandomComboSelection'
    | 'playRandomMotionCombo'
    | 'stopRandomMotionCombo'
  >;
}) {
  const {
    randomComboOpen,
    setRandomComboOpen,
    randomComboSelections,
    randomizeMotionCombo,
    updateRandomComboSelection,
    playRandomMotionCombo,
    stopRandomMotionCombo
  } = motionTests;

  return (
    <section className="randomComboWorkbench" data-open={randomComboOpen}>
      <div className="randomComboToolbar">
        <button
          aria-expanded={randomComboOpen}
          className="randomComboTrigger"
          onClick={randomizeMotionCombo}
          type="button"
        >
          <Sparkles size={17} />
          Random Motion Combo
        </button>
        {randomComboOpen ? (
          <>
            <button onClick={() => void playRandomMotionCombo()} type="button">
              <Play size={17} />
              Play Combo
            </button>
            <button onClick={stopRandomMotionCombo} type="button">
              <Square size={17} />
              Stop
            </button>
            <button onClick={() => setRandomComboOpen(false)} type="button">
              <ChevronDown size={17} />
              Close
            </button>
          </>
        ) : null}
      </div>
      {randomComboOpen ? (
        <div className="randomComboGrid">
          {actionBodyPartOrder.map((part) => {
            const selection = randomComboSelections[part];
            const motion = findManualTestMotion(selection.motionId);
            const configuredAction = motion ? findConfiguredActionForMotion(motion) : undefined;
            const holdAvailable = Boolean(configuredAction?.split);

            return (
              <div className="randomComboRow" key={part}>
                <strong>{part}</strong>
                <select
                  aria-label={`${part} VRMA`}
                  value={selection.motionId}
                  onChange={(event) =>
                    updateRandomComboSelection(part, { motionId: event.currentTarget.value })
                  }
                >
                  {vrmaManualTestMotions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {formatComboMotionLabel(option)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`${part} parameter`}
                  value={selection.mode}
                  onChange={(event) =>
                    updateRandomComboSelection(part, { mode: event.currentTarget.value as RandomComboMode })
                  }
                >
                  <option value="full">full</option>
                  {holdAvailable ? <option value="hold">hold</option> : null}
                </select>
                {selection.mode === 'hold' && holdAvailable ? (
                  <label className="randomComboDuration">
                    <input
                      aria-label={`${part} hold duration seconds`}
                      min={0.1}
                      placeholder="loop"
                      step={0.1}
                      type="number"
                      value={selection.durationSeconds}
                      onChange={(event) =>
                        updateRandomComboSelection(part, { durationSeconds: event.currentTarget.value })
                      }
                    />
                    <span>s</span>
                  </label>
                ) : (
                  <span className="randomComboLoopLabel">loop</span>
                )}
                <small>{configuredAction ? `action: ${configuredAction.id}` : 'full only'}</small>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
