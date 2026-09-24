import type {
  BodyChannelState,
  BodyMotionPlaybackAdapter,
  MotionLayer,
  PlayMotionOptions,
  ResolvedPlayMotionOptions,
  VrmAnimationBoneMappingReport
} from '../../app/runtimeTypes';
import type { MotionAssetRegistry } from './MotionAssetRegistry';
import { summarizeVrmAnimationBoneMapping } from './VrmaBoneMapper';
import type { RuntimeStore } from '../../app/state/RuntimeStore';
import { delay, throwIfAborted } from '../../app/utils/delay';

export class BodyMotionController {
  private stopToken = 0;
  private paused = false;
  private readonly layerTokens = new Map<MotionLayer, number>();
  private readonly loggedVrmBoneMappings = new Set<string>();

  constructor(
    private readonly registry: MotionAssetRegistry,
    private readonly store: RuntimeStore,
    private readonly playbackAdapter?: BodyMotionPlaybackAdapter
  ) {}

  async preload(id: string, signal?: AbortSignal): Promise<void> {
    await this.registry.preload(id, signal);
    this.patchBody({
      loadedIds: this.registry.loadedIds()
    });
  }

  async play(id: string, options: PlayMotionOptions = {}): Promise<void> {
    throwIfAborted(options.signal);
    const meta = this.registry.get(id);
    const layer = options.layer ?? meta.layer ?? 'base';
    const token = this.nextLayerToken(layer);
    const stopToken = this.stopToken;
    const resolvedOptions: ResolvedPlayMotionOptions = {
      fadeIn: options.fadeIn ?? meta.defaultFadeIn,
      fadeOut: options.fadeOut ?? meta.defaultFadeOut,
      loop: options.loop ?? meta.loop,
      layer,
      mask: options.mask ?? meta.mask,
      clampWhenFinished: options.clampWhenFinished ?? true,
      returnToIdle: options.returnToIdle ?? meta.returnToIdle,
      signal: options.signal
    };

    this.patchBody({
      currentAction: id,
      phase: 'loading',
      loop: resolvedOptions.loop,
      activeLayers: this.withActiveLayer(layer, id),
      lastFadeMs: toMs(resolvedOptions.fadeIn)
    });

    const loadedMotion = await this.registry.preload(id, options.signal);
    this.logVrmBoneMapping(id, loadedMotion.vrmBoneMapping);
    this.patchBody({
      loadedIds: this.registry.loadedIds()
    });

    if (!this.isCurrentLayerAction(layer, token, stopToken)) {
      return;
    }

    this.patchBody({
      currentAction: id,
      phase: 'playing',
      loop: resolvedOptions.loop,
      activeLayers: this.withActiveLayer(layer, id),
      lastFadeMs: toMs(resolvedOptions.fadeIn)
    });

    if (this.playbackAdapter) {
      await this.playbackAdapter.playMotion(loadedMotion, resolvedOptions);
    } else if (resolvedOptions.loop === 'once') {
      await delay(meta.durationMs, options.signal);
    }

    if (resolvedOptions.loop === 'repeat') {
      return;
    }

    if (!this.isCurrentLayerAction(layer, token, stopToken)) {
      return;
    }

    this.patchBody({
      currentAction: id,
      phase: 'complete',
      loop: resolvedOptions.loop,
      activeLayers: this.withActiveLayer(layer, id),
      lastFadeMs: toMs(resolvedOptions.fadeOut)
    });

    if (resolvedOptions.returnToIdle) {
      await this.returnToIdle(resolvedOptions.fadeOut, options.signal);
    }
  }

  async crossFadeTo(id: string, duration = 0.2, signal?: AbortSignal): Promise<void> {
    await this.play(id, {
      fadeIn: duration,
      fadeOut: duration,
      signal
    });
  }

  async stop(duration = 0, signal?: AbortSignal): Promise<void> {
    this.setPaused(false);
    this.stopToken += 1;
    this.layerTokens.clear();
    if (this.playbackAdapter) {
      await this.playbackAdapter.stop(duration, signal);
    } else {
      await delay(toMs(duration), signal);
    }
    this.patchBody({
      currentAction: undefined,
      phase: 'stopped',
      loop: undefined,
      activeLayers: {},
      lastFadeMs: toMs(duration)
    });
  }

  async returnToIdle(duration = 0.15, signal?: AbortSignal): Promise<void> {
    const idle = this.registry.get('idle_neutral');
    const layer = idle.layer ?? 'base';
    const token = this.nextLayerToken(layer);
    const stopToken = this.stopToken;
    const loadedMotion = await this.registry.preload(idle.id, signal);
    this.logVrmBoneMapping(idle.id, loadedMotion.vrmBoneMapping);
    this.patchBody({
      loadedIds: this.registry.loadedIds()
    });

    if (!this.isCurrentLayerAction(layer, token, stopToken)) {
      return;
    }

    if (this.playbackAdapter) {
      await this.playbackAdapter.playMotion(loadedMotion, {
        fadeIn: duration,
        fadeOut: idle.defaultFadeOut,
        loop: idle.loop,
        layer,
        mask: idle.mask,
        clampWhenFinished: false,
        returnToIdle: false,
        signal
      });
    }

    this.patchBody({
      currentAction: idle.id,
      phase: 'playing',
      loop: idle.loop,
      activeLayers: this.withActiveLayer(layer, idle.id),
      lastFadeMs: toMs(duration)
    });
  }

  update(deltaSeconds: number): void {
    if (this.paused && !this.playbackAdapter?.setPaused) {
      return;
    }

    this.playbackAdapter?.update?.(deltaSeconds);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.playbackAdapter?.setPaused?.(paused);
  }

  private logVrmBoneMapping(motionId: string, report: VrmAnimationBoneMappingReport | undefined): void {
    if (!report || this.loggedVrmBoneMappings.has(motionId)) {
      return;
    }

    this.loggedVrmBoneMappings.add(motionId);
    const summary = summarizeVrmAnimationBoneMapping(report, motionId);
    this.store.appendLog(summary.message, summary.level);
  }

  private patchBody(partial: Partial<BodyChannelState>): void {
    this.store.patch({
      body: {
        ...this.store.getSnapshot().body,
        ...partial
      }
    });
  }

  private nextLayerToken(layer: MotionLayer): number {
    const token = (this.layerTokens.get(layer) ?? 0) + 1;
    this.layerTokens.set(layer, token);
    return token;
  }

  private isCurrentLayerAction(layer: MotionLayer, token: number, stopToken: number): boolean {
    return this.stopToken === stopToken && this.layerTokens.get(layer) === token;
  }

  private withActiveLayer(layer: MotionLayer, id: string): BodyChannelState['activeLayers'] {
    return {
      ...this.store.getSnapshot().body.activeLayers,
      [layer]: id
    };
  }
}

function toMs(seconds: number): number {
  return Math.round(seconds * 1000);
}
