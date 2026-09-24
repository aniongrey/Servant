import { type RuntimeSnapshot, type ActionBodyPart } from '../../app/runtimeTypes';
import { actionBodyPartOrder } from '../../character/motion/actions/actionBodyParts';

export function formatActiveLayers(activeLayers: RuntimeSnapshot['body']['activeLayers']): string {
  const active = Object.entries(activeLayers).map(([layer, motionId]) => `${layer}:${motionId}`);
  return active.join(', ') || 'none';
}

export function formatActionPartState(activeParts: RuntimeSnapshot['action']['activeParts']): string {
  const active = actionBodyPartOrder
    .map((part) => {
      const state = activeParts[part];
      return state ? `${part}:${state.actionId}/${state.phase}` : undefined;
    })
    .filter(Boolean);

  return active.join(', ') || 'none';
}

export function formatActionPartOwner(
  part: ActionBodyPart,
  activeParts: RuntimeSnapshot['action']['activeParts']
): string {
  const state = activeParts[part];
  return state ? `${state.actionId} / ${state.phase}` : 'idle';
}

export function formatCooldowns(cooldowns: Record<string, number>): string {
  const active = Object.entries(cooldowns)
    .map(([id, until]) => [id, Math.max(0, until - Date.now())] as const)
    .filter(([, remaining]) => remaining > 0)
    .map(([id, remaining]) => `${id}:${Math.ceil(remaining / 1000)}s`);

  return active.join(', ') || 'ready';
}
