import type { ExpressionPlaybackAdapter, ExpressionState } from '../../app/runtimeTypes';
import type { RuntimeStore } from '../../app/state/RuntimeStore';
import { delay, throwIfAborted } from '../../app/utils/delay';
import config from '../motion/assets/actions/full-body-motion-config.json';

export type NativeExpression = keyof typeof config.expressions;
export const nativeExpressionIds = Object.keys(config.expressions) as NativeExpression[];

export class ExpressionController {
  constructor(
    private readonly store: RuntimeStore,
    private readonly playbackAdapter?: ExpressionPlaybackAdapter
  ) {}

  async set(
    id: string,
    weight: number,
    duration = 0,
    gaze: ExpressionState['gaze'] = this.store.getSnapshot().expression.gaze,
    signal?: AbortSignal
  ): Promise<void> {
    throwIfAborted(signal);
    id = id === 'natural' ? 'neutral' : id;
    id = config.expressions[id as NativeExpression] ?? id;
    this.store.patch({
      expression: {
        id,
        weight,
        gaze
      }
    });
    this.playbackAdapter?.setExpression(id, weight);
    await delay(duration, signal);
  }
}
