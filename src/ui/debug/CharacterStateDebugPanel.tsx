import { type DebugPanelSectionId, characterRelationshipLabels, characterEmotionLabels } from './debugConfig';
import { Sparkles, RotateCcw, FastForward } from 'lucide-react';
import { DebugSection, StateMeter } from './DebugControls';
import type { DebugCharacterState } from './useDebugCharacterState';

export function CharacterStateDebugPanel({
  open,
  onToggle,
  characterStateControls
}: {
  open: boolean;
  onToggle: (section: DebugPanelSectionId, open: boolean) => void;
  characterStateControls: DebugCharacterState;
}) {
  const { characterState, characterContext, applyCharacterEvent, tickCharacterState, resetCharacterState } =
    characterStateControls;
  return (
    <DebugSection id="characterState" onToggle={onToggle} open={open} title="Soul State">
      <div className="characterStateGrid">
        {(Object.keys(characterRelationshipLabels) as Array<keyof typeof characterState.relation>).map(
          (key) => (
            <StateMeter
              key={key}
              label={characterRelationshipLabels[key]}
              value={characterState.relation[key]}
            />
          )
        )}
        {(Object.keys(characterEmotionLabels) as Array<keyof typeof characterState.mood>).map((key) => (
          <StateMeter key={key} label={characterEmotionLabels[key]} value={characterState.mood[key]} />
        ))}
      </div>
      <div className="buttonGrid compact">
        <button onClick={() => applyCharacterEvent('praise', '用户夸奖了 Shiro')} type="button">
          <Sparkles size={17} /> Praise
        </button>
        <button onClick={() => tickCharacterState(10 * 60_000)} type="button">
          <FastForward size={17} /> Decay 10m
        </button>
        <button onClick={resetCharacterState} type="button">
          <RotateCcw size={17} /> Reset State
        </button>
      </div>
      <pre className="characterContextPreview">{characterContext}</pre>
      <p className="hintText">
        SoulManager owns numeric state; the LLM only receives this descriptive context.
      </p>
    </DebugSection>
  );
}
