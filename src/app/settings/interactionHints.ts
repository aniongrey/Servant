/**
 * What the 「交互提示」 preference controls on the character surface.
 *
 * The switch is the only knob for "how much of the runtime's own telemetry does
 * the character show", so every surface reads its flag from here instead of
 * re-deriving the meaning of the preference. Adding one more hint means adding
 * one field, which keeps the surfaces from drifting apart.
 */
export interface InteractionHintVisibility {
  /** Activity chips in the corner of the pet window (倾听中 / 思考中 …). */
  characterStatus: boolean;
  /** Tool result card (联网查询 / 定时工具). */
  toolResult: boolean;
  /** Speech bubble above the character. */
  speechBubble: boolean;
}

export function resolveInteractionHints(enabled: boolean): InteractionHintVisibility {
  return {
    characterStatus: enabled,
    toolResult: enabled,
    speechBubble: enabled
  };
}
