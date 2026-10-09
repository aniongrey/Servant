/** Config selects registered code, never executable JavaScript. */
export const actionBehaviorLabels = { wear_iron_basin: '头戴不锈钢锅' } as const;
export type ActionBehaviorId = keyof typeof actionBehaviorLabels;
export function isActionBehaviorId(value: unknown): value is ActionBehaviorId {
  return typeof value === 'string' && Object.hasOwn(actionBehaviorLabels, value);
}
export interface ActionBehaviorPlayer {
  play(id: ActionBehaviorId, durationSeconds: number, signal: AbortSignal): Promise<void>;
  clear(): void;
}
