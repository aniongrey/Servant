import type { ActionRuntime } from '../actions/ActionRuntime';
import { resolveReplyShortActionId } from './shortActionVocabulary';

/**
 * 把 LLM 的 `shortAction` 落到角色身体上。
 *
 * 只负责身体动作：`emotion` 的表现层负责脸，所以一律传 `presentation: false`，
 * 组合动作自带的 `expression`/`microdynamics` 不再抢表情。
 */
export class ReplyShortActionRuntime {
  constructor(
    private readonly actions: Pick<ActionRuntime, 'play' | 'returnToIdle'> &
      Partial<Pick<ActionRuntime, 'startSpeaking' | 'fillSpeaking'>>
  ) {}

  startSpeaking(): void {
    this.actions.startSpeaking?.();
    this.actions.fillSpeaking?.();
  }

  async play(id: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    this.actions.startSpeaking?.();
    await this.actions.play([resolveReplyShortActionId(id)], { signal, presentation: false });
  }

  returnToIdle(): void {
    this.actions.returnToIdle();
  }
}
