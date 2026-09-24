import interactionConfig from './assets/interaction.config.json';
import type { ActionRuntime } from '../motion/actions/ActionRuntime';
import type { SpeechController } from '../../ai/tts/SpeechController';
import type { RuntimeStore } from '../../app/state/RuntimeStore';

export type CharacterInteractionState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'dancing' | 'error';
export type CharacterActivityStatus = 'listening' | 'thinking' | 'typing' | 'searching';
export interface CharacterInteractionEffects {
  onHeadSquash?(): void;
  onProtectedHeadTap?(): void;
  onProtectionStart?(): void;
}
export interface CharacterInteractionDebugSnapshot {
  state: CharacterInteractionState;
  musicPlaying: boolean;
  headTouchCount: number;
  headTouchTriggerCount: number;
  protected: boolean;
  protectedRemainingMs: number;
  protectedTapCount: number;
}
interface IdleAction {
  id: string;
  weight: number;
}
interface InteractionConfig {
  headTouch: {
    windowMs: number;
    triggerCount: number;
    protectDurationMs: number;
    warningProbability: number;
    tokenJokePrice: number;
  };
  idle: { eventIntervalMinMs: number; eventIntervalMaxMs: number; actions: IdleAction[] };
}
const config = interactionConfig as InteractionConfig;
export class CharacterInteractionController {
  private state: CharacterInteractionState = 'idle';
  private musicPlaying = false;
  private protectedUntil = 0;
  private protectedTapCount = 0;
  private headTouches: number[] = [];
  private idleTimer?: ReturnType<typeof setTimeout>;
  private errorTimer?: ReturnType<typeof setTimeout>;
  private speechStarted = false;
  private activityStatuses = new Set<CharacterActivityStatus>();
  private activityListeners = new Set<(statuses: CharacterActivityStatus[]) => void>();
  private readonly speechAbort = new AbortController();
  private readonly unsubscribe: () => void;
  constructor(
    private readonly action: ActionRuntime,
    private readonly speech: SpeechController,
    private readonly store: RuntimeStore,
    private readonly effects: CharacterInteractionEffects = {}
  ) {
    this.action.start();
    this.unsubscribe = store.subscribe(() => {
      const speaking = store.getSnapshot().speech.speaking;
      if (this.state === 'speaking' && speaking) this.speechStarted = true;
      if (this.state === 'speaking' && this.speechStarted && !speaking) this.onSpeechEnd();
    });
  }
  getState(): CharacterInteractionState {
    return this.state;
  }
  getActivityStatuses(): CharacterActivityStatus[] {
    return [...this.activityStatuses];
  }
  subscribeActivityStatuses(listener: (statuses: CharacterActivityStatus[]) => void): () => void {
    this.activityListeners.add(listener);
    listener(this.getActivityStatuses());
    return () => this.activityListeners.delete(listener);
  }
  replaceActivityStatuses(statuses: readonly CharacterActivityStatus[]): void {
    const next = new Set(statuses);
    if (
      next.size === this.activityStatuses.size &&
      [...next].every((status) => this.activityStatuses.has(status))
    )
      return;
    this.activityStatuses = next;
    const snapshot = this.getActivityStatuses();
    this.activityListeners.forEach((listener) => listener(snapshot));
  }
  getDebugSnapshot(now = Date.now()): CharacterInteractionDebugSnapshot {
    this.headTouches = this.headTouches.filter((time) => now - time <= config.headTouch.windowMs);
    return {
      state: this.state,
      musicPlaying: this.musicPlaying,
      headTouchCount: this.headTouches.length,
      headTouchTriggerCount: config.headTouch.triggerCount,
      protected: now < this.protectedUntil,
      protectedRemainingMs: Math.max(0, this.protectedUntil - now),
      protectedTapCount: this.protectedTapCount
    };
  }
  setState(next: CharacterInteractionState): void {
    if (this.state === next) return;
    this.state = next;
    const statuses: CharacterActivityStatus[] = this.getActivityStatuses().filter(
      (status) => status !== 'listening' && status !== 'thinking' && status !== 'typing'
    );
    if (next === 'listening' || next === 'thinking') statuses.unshift(next);
    this.replaceActivityStatuses(statuses);
    this.store.appendLog(`Interaction state: ${next}`);
    this.clearIdleTimer();
    if (next !== 'error') this.clearErrorTimer();
    this.action.notifyInteraction();
    if (next === 'error') this.errorTimer = setTimeout(() => this.setState('idle'), 1500);
  }
  onListeningStart(): void {
    this.setState('listening');
  }
  onListeningEnd(): void {
    this.setState('thinking');
  }
  onLlmResponseStart(): void {
    this.speechStarted = false;
    this.setState('speaking');
  }
  onSpeechEnd(): void {
    this.setState(this.musicPlaying ? 'dancing' : 'idle');
  }
  onError(): void {
    this.setState('error');
  }
  setMusicPlaying(playing: boolean): void {
    this.musicPlaying = playing;
    if (playing && this.state === 'idle') this.setState('dancing');
    if (!playing && this.state === 'dancing') this.setState('idle');
  }
  onGreeting(): void {
    if (this.state !== 'error') {
      this.action.playEmotion('开心拍手');
      void this.speech.sayText('你好呀。', { intent: 'greeting_hello' });
    }
  }
  onHeadClick(): void {
    const now = Date.now();
    if (now < this.protectedUntil) {
      this.protectedTapCount += 1;
      this.effects.onProtectedHeadTap?.();
      this.store.appendLog('Protect-head tap: dong');
      return;
    }
    this.effects.onHeadSquash?.();
    this.headTouches = this.headTouches.filter((time) => now - time <= config.headTouch.windowMs);
    this.headTouches.push(now);
    this.store.appendLog(`Head touch: ${this.headTouches.length}/${config.headTouch.triggerCount}`);
    if (this.headTouches.length >= config.headTouch.triggerCount) {
      this.headTouches = [];
      this.protectedUntil = now + config.headTouch.protectDurationMs;
      this.effects.onProtectionStart?.();
      this.action.playEmotion('无奈');
      if (Math.random() < config.headTouch.warningProbability) this.warnAboutHeadTouches();
    }
  }
  dispose(): void {
    this.speechAbort.abort();
    this.clearIdleTimer();
    this.clearErrorTimer();
    this.unsubscribe();
    this.activityListeners.clear();
  }
  private warnAboutHeadTouches(): void {
    const text = `警告！刚刚连续摸头已经消耗 Token，折合人民币 ${config.headTouch.tokenJokePrice.toFixed(
      2
    )} 元。`;
    void this.speech
      .sayLocalizedText(text, { intent: 'protect_head', signal: this.speechAbort.signal })
      .catch((error) => {
        if (!this.speechAbort.signal.aborted)
          this.store.appendLog(`Protect-head speech failed: ${error}`, 'error');
      });
  }
  private scheduleIdleEvent(): void {
    const { eventIntervalMinMs: min, eventIntervalMaxMs: max } = config.idle;
    this.idleTimer = setTimeout(() => {
      if (this.state !== 'idle') return;
      const event = pickWeighted(config.idle.actions);
      if (event) this.action.playEmotion(event.id);
      this.scheduleIdleEvent();
    }, min + Math.random() * Math.max(0, max - min));
  }
  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }
  private clearErrorTimer(): void {
    if (this.errorTimer) clearTimeout(this.errorTimer);
    this.errorTimer = undefined;
  }
}
function pickWeighted(actions: IdleAction[]): IdleAction | undefined {
  const total = actions.reduce((sum, action) => sum + Math.max(0, action.weight), 0);
  if (total <= 0) return undefined;
  let point = Math.random() * total;
  return actions.find((action) => (point -= Math.max(0, action.weight)) <= 0) ?? actions.at(-1);
}
