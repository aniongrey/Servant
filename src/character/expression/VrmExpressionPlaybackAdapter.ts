import type { VRM } from '@pixiv/three-vrm';
import type { ExpressionPlaybackAdapter, GazePlaybackAdapter, GazeTarget } from '../../app/runtimeTypes';
import { nativeExpressionIds } from './ExpressionController';

export class VrmExpressionPlaybackAdapter implements ExpressionPlaybackAdapter {
  constructor(private readonly vrm: VRM) {}

  setExpression(id: string, weight: number): void {
    const manager = this.vrm.expressionManager;
    if (!manager) {
      return;
    }

    for (const expressionId of nativeExpressionIds) {
      if (expressionId !== id) manager.setValue(expressionId, 0);
    }
    manager.setValue(id, clamp01(weight));
    manager.update();
  }
}

export class VrmGazePlaybackAdapter implements GazePlaybackAdapter {
  constructor(private readonly vrm: VRM) {}

  look(target: GazeTarget): void {
    const manager = this.vrm.expressionManager;
    if (!manager) {
      return;
    }

    manager.setValue('lookLeft', 0);
    manager.setValue('lookRight', 0);
    manager.setValue('lookUp', 0);
    manager.setValue('lookDown', 0);

    if (target === 'avoid') {
      manager.setValue('lookLeft', 0.7);
    }

    if (target === 'peek') {
      manager.setValue('lookRight', 0.35);
    }

    manager.update();
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
