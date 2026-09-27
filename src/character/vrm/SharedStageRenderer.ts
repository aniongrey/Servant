import * as THREE from 'three';
import {
  advanceActorFrameSchedule,
  advanceStageFrameClock,
  createActorFrameSchedule,
  createStageFrameClock,
  type ActorFrameSchedule,
  type StageFrameClock
} from './stageFrameClock';
import { actorViewportOrigin, isActorVisible, readActorLayer, toCanvasBox, type CanvasBox } from './stageLayout';

export interface StageRenderActor {
  id: string;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  viewport: HTMLElement;
  update(deltaSeconds: number, nowSeconds: number): void;
  updateRate(): number;
}

/** Actor box in canvas CSS pixels. Cached until something signals a layout change. */
type ActorBox = CanvasBox;

type RenderEntry = StageRenderActor & {
  target: THREE.WebGLRenderTarget;
  dirty: boolean;
  schedule: ActorFrameSchedule;
  box: ActorBox | null;
  layer: number;
  mutations: MutationObserver | null;
  resizeObserver: ResizeObserver | null;
};

/**
 * What the last sampling window actually cost.
 *
 * Read this before deciding whether the per-actor texture plus its composite pass
 * is worth removing: `compositePixelsPerFrame` is the fill rate the composite adds
 * on top of the actor textures, and `drawCallsPerFrame` counts the extra pass per
 * actor. These are CPU-side and driver-reported numbers — real GPU time needs the
 * browser's GPU profiler, or `EXT_disjoint_timer_query_webgl2`.
 */
export interface StageStats {
  framesPerSecond: number;
  cpuMsPerFrame: number;
  cpuMsUpdating: number;
  cpuMsDrawing: number;
  drawCallsPerFrame: number;
  trianglesPerFrame: number;
  /** Pixels rendered into actor textures, counting only frames an actor redrew. */
  actorTexturePixelsPerFrame: number;
  /** Pixels the composite pass writes to the canvas every frame. */
  compositePixelsPerFrame: number;
  actors: number;
  targetPixelRatio: number;
  gpu: string;
}

const ACTOR_SELECTOR = '.desktop-cast-actor';

/** Longest single animation step handed to an actor; longer frames are split. */
const SUB_STEP_SECONDS = 0.05;

/** How often the rolling counters are folded into a published snapshot. */
const STATS_WINDOW_MS = 2000;

/** Reads the stacking order the desktop window manager assigns. */
function actorLayerOf(viewport: HTMLElement): number {
  const element = viewport.closest<HTMLElement>(ACTOR_SELECTOR);
  return readActorLayer(element?.getAttribute('data-layer') ?? null, viewport.style.zIndex);
}

/** One WebGL context and animation clock for all desktop actors. */
export class SharedStageRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly actors = new Map<string, RenderEntry>();
  private readonly compositeScene = new THREE.Scene();
  private readonly compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  private readonly compositeMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false });
  private readonly compositePlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMaterial);
  private readonly clock: StageFrameClock = createStageFrameClock();
  private frame = 0;
  private disposed = false;
  private targetPixelRatio = 1;
  private canvasBox: ActorBox = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  /** Rebuilt only when something signals that a box or the stacking order moved. */
  private drawOrder: RenderEntry[] = [];
  private layoutDirty = true;
  private stats = createStatsWindow();
  private latestStats: StageStats | null = null;
  private readonly gpuName: string;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;
    // Counters are read once per stage frame, so they must not be reset by each of
    // the individual `render()` calls inside it.
    this.renderer.info.autoReset = false;
    this.compositeCamera.position.z = 1;
    this.compositeScene.add(this.compositePlane);
    this.gpuName = readGpuName(this.renderer);
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('scroll', this.invalidateLayout, true);
    this.frame = requestAnimationFrame(this.tick);
  }

  register(actor: StageRenderActor): () => void {
    const entry: RenderEntry = {
      ...actor,
      target: new THREE.WebGLRenderTarget(1, 1),
      dirty: true,
      schedule: createActorFrameSchedule(),
      box: null,
      layer: 0,
      mutations: null,
      resizeObserver: null
    };
    entry.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.actors.set(actor.id, entry);
    this.observeActor(entry);
    this.resizeTargets();
    this.resizeActor(actor);
    this.invalidateLayout();
    return () => {
      entry.mutations?.disconnect();
      entry.resizeObserver?.disconnect();
      this.actors.delete(actor.id);
      entry.target.dispose();
      this.resizeTargets();
      this.invalidateLayout();
    };
  }

  get webglRenderer(): THREE.WebGLRenderer { return this.renderer; }

  private capture: (() => void) | null = null;
  /** Read immediately after composition, before WebGL discards its drawing buffer. */
  captureFrame(): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
      if (this.disposed || this.capture) { reject(new Error('舞台截图暂不可用')); return; }
      const timeout = setTimeout(() => { this.capture = null; reject(new Error('舞台截图超时，请保持舞台可见后重试')); }, 5000);
      this.capture = () => {
        clearTimeout(timeout);
        try {
          const copy = document.createElement('canvas');
          copy.width = this.canvas.width; copy.height = this.canvas.height;
          const context = copy.getContext('2d');
          if (!context) throw new Error('无法创建截图画布');
          context.drawImage(this.canvas, 0, 0);
          resolve(copy);
        } catch (cause) { reject(cause); }
      };
    });
  }

  /**
   * Latest cost snapshot, or null until the first sampling window has closed.
   * Enabled by default; `?stageStats=1` also logs it to the console every window.
   */
  getStageStats(): StageStats | null { return this.latestStats; }

  resizeViewport(camera: THREE.PerspectiveCamera, viewport: HTMLElement): void {
    const { width, height } = viewport.getBoundingClientRect();
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    const actor = [...this.actors.values()].find((entry) => entry.viewport === viewport);
    if (!actor) return;
    const targetWidth = Math.max(1, Math.round(width * this.targetPixelRatio));
    const targetHeight = Math.max(1, Math.round(height * this.targetPixelRatio));
    if (actor.target.width !== targetWidth || actor.target.height !== targetHeight) actor.target.setSize(targetWidth, targetHeight);
    actor.dirty = true;
    // The callers are "the viewport may have changed" signals, so drop the cached box.
    this.layoutDirty = true;
  }

  resizeActor(actor: StageRenderActor): void {
    const { width, height } = actor.viewport.getBoundingClientRect();
    actor.camera.aspect = width / Math.max(1, height);
    actor.camera.updateProjectionMatrix();
    const entry = this.actors.get(actor.id);
    if (entry) entry.dirty = true;
    this.layoutDirty = true;
  }

  invalidate(id: string): void { const actor = this.actors.get(id); if (actor) actor.dirty = true; }

  /** Drops the cached boxes and stacking order; the next frame re-reads them. */
  invalidateLayout = (): void => { this.layoutDirty = true; };

  /**
   * Wires up the signals that mean the cached layout has gone stale.
   *
   * A desktop window moves by writing `style.left`/`style.bottom` straight onto the
   * actor element and restacks by rewriting `data-layer`, so neither a resize event
   * nor a React render is guaranteed — attribute mutations are the reliable signal.
   * Deliberately not `subtree`: the frame loop writes the speech bubble's own
   * `style.left`/`top`, and observing descendants would feed those writes back in.
   */
  private observeActor(entry: RenderEntry): void {
    const element = entry.viewport.closest<HTMLElement>(ACTOR_SELECTOR);
    if (element && typeof MutationObserver !== 'undefined') {
      entry.mutations = new MutationObserver(this.invalidateLayout);
      entry.mutations.observe(element, {
        attributes: true,
        attributeFilter: ['style', 'class', 'data-free', 'data-layer', 'data-dragging', 'hidden']
      });
    }
    if (typeof ResizeObserver !== 'undefined') {
      entry.resizeObserver = new ResizeObserver(this.invalidateLayout);
      entry.resizeObserver.observe(entry.viewport);
    }
  }

  private resize = (): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
    this.resizeTargets();
    for (const actor of this.actors.values()) this.resizeActor(actor);
  };

  private resizeTargets(): void {
    const actors = [...this.actors.values()];
    const rects = actors.map((actor) => actor.viewport.getBoundingClientRect());
    const area = rects.reduce((sum, rect) => sum + rect.width * rect.height, 0);
    const largestSide = Math.max(1, ...rects.map((rect) => Math.max(rect.width, rect.height)));
    const pixelRatio = Math.min(
      this.renderer.getPixelRatio(),
      2048 / largestSide,
      Math.sqrt(12_000_000 / Math.max(1, area))
    );
    this.targetPixelRatio = pixelRatio;
    actors.forEach((actor, index) => {
      const rect = rects[index];
      actor.target.setSize(Math.max(1, Math.round(rect.width * pixelRatio)), Math.max(1, Math.round(rect.height * pixelRatio)));
      actor.dirty = true;
    });
  }

  /**
   * Re-reads the canvas box and every actor box, and re-sorts the draw order.
   *
   * This is the only place in the frame path that touches layout, and it runs on a
   * signal rather than every frame. It used to run unconditionally: one canvas rect
   * plus one rect per actor plus a `closest()` and an attribute read per actor, all
   * before a sort — per frame, per actor.
   */
  private measureLayout(): void {
    this.layoutDirty = false;
    const canvas = this.canvas.getBoundingClientRect();
    this.canvasBox = toCanvasBox(canvas, canvas);
    const order: RenderEntry[] = [];
    for (const actor of this.actors.values()) {
      actor.box = toCanvasBox(canvas, actor.viewport.getBoundingClientRect());
      actor.layer = actorLayerOf(actor.viewport);
      order.push(actor);
    }
    order.sort((a, b) => a.layer - b.layer);
    this.drawOrder = order;
  }

  /** The stage runs at the highest rate any actor asked for. */
  private stageUpdateRate(): number {
    let rate = 0;
    for (const actor of this.actors.values()) rate = Math.max(rate, actor.updateRate());
    return Math.max(1, rate);
  }

  private tick = (time: number): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
    // Nothing to draw behind a hidden window, and browsers throttle rAF there
    // anyway. The clock's backlog ceiling absorbs the gap, so coming back draws one
    // frame rather than a burst of them.
    if (document.visibilityState === 'hidden') return;

    const decision = advanceStageFrameClock(this.clock, time, this.stageUpdateRate());
    if (!decision.draw) return;

    // Two `performance.now()` pairs per actor per drawn frame: about 2 µs a frame
    // with eight actors, which is worth paying to be able to answer "is this
    // actually drawing more than it did before" without a profiler attached.
    const frameStartedAt = performance.now();
    let updateMs = 0;
    let drawMs = 0;
    let texturePixels = 0;
    let compositePixels = 0;

    this.renderer.info.reset();
    if (this.layoutDirty) this.measureLayout();

    const canvasBox = this.canvasBox;
    const canvasPixelRatio = this.renderer.getPixelRatio();
    const nowSeconds = time / 1000;
    this.renderer.setScissorTest(false);
    this.renderer.clear(true, true, true);
    this.renderer.setScissorTest(true);

    for (const actor of this.drawOrder) {
      const box = actor.box;
      if (!box || !isActorVisible(box, canvasBox)) continue;

      const updateStartedAt = performance.now();
      // Off-screen actors are skipped entirely, so their schedule simply falls
      // behind; the step ceiling means they resume with one normal-length frame.
      const due = advanceActorFrameSchedule(
        actor.schedule,
        decision.clockSeconds,
        actor.updateRate(),
        decision.deltaSeconds
      );
      if (due.update) {
        let remaining = due.deltaSeconds;
        let consumed = 0;
        do {
          const chunk = Math.min(SUB_STEP_SECONDS, remaining);
          consumed += chunk;
          actor.update(chunk, nowSeconds - due.deltaSeconds + consumed);
          remaining -= chunk;
        } while (remaining > 1e-6);
        actor.dirty = true;
      }
      updateMs += performance.now() - updateStartedAt;

      const drawStartedAt = performance.now();
      const left = box.left;
      const bottom = actorViewportOrigin(box, canvasBox.height);
      this.renderer.setViewport(left, bottom, box.width, box.height);
      this.renderer.setScissor(
        Math.max(0, left), Math.max(0, bottom),
        Math.max(0, Math.min(canvasBox.width, box.right) - Math.max(0, left)),
        Math.max(0, Math.min(canvasBox.height, box.bottom) - Math.max(0, bottom))
      );
      if (actor.dirty) {
        this.renderer.setRenderTarget(actor.target);
        this.renderer.setScissorTest(false);
        this.renderer.clear(true, true, true);
        this.renderer.render(actor.scene, actor.camera);
        this.renderer.setRenderTarget(null);
        this.renderer.setScissorTest(true);
        actor.dirty = false;
        texturePixels +=
          Math.max(1, Math.round(box.width * this.targetPixelRatio)) *
          Math.max(1, Math.round(box.height * this.targetPixelRatio));
      }
      this.compositeMaterial.map = actor.target.texture;
      this.renderer.render(this.compositeScene, this.compositeCamera);
      compositePixels += box.width * canvasPixelRatio * box.height * canvasPixelRatio;
      drawMs += performance.now() - drawStartedAt;
    }
    this.renderer.setScissorTest(false);

    const capture = this.capture;
    this.capture = null;
    capture?.();
    this.sampleStats({
      frameMs: performance.now() - frameStartedAt,
      updateMs,
      drawMs,
      texturePixels,
      compositePixels
    });
  };

  private sampleStats(sample: {
    frameMs: number;
    updateMs: number;
    drawMs: number;
    texturePixels: number;
    compositePixels: number;
  }): void {
    const stats = this.stats;
    if (stats.frames === 0) stats.startedAt = performance.now();
    stats.frames += 1;
    stats.frameMs += sample.frameMs;
    stats.updateMs += sample.updateMs;
    stats.drawMs += sample.drawMs;
    stats.texturePixels += sample.texturePixels;
    stats.compositePixels += sample.compositePixels;
    stats.drawCalls += this.renderer.info.render.calls;
    stats.triangles += this.renderer.info.render.triangles;

    const finishedAt = performance.now();
    const elapsed = finishedAt - stats.startedAt;
    if (elapsed < STATS_WINDOW_MS) return;

    const frames = stats.frames;
    this.latestStats = {
      framesPerSecond: (frames * 1000) / elapsed,
      cpuMsPerFrame: stats.frameMs / frames,
      cpuMsUpdating: stats.updateMs / frames,
      cpuMsDrawing: stats.drawMs / frames,
      drawCallsPerFrame: stats.drawCalls / frames,
      trianglesPerFrame: stats.triangles / frames,
      actorTexturePixelsPerFrame: stats.texturePixels / frames,
      compositePixelsPerFrame: stats.compositePixels / frames,
      actors: this.actors.size,
      targetPixelRatio: this.targetPixelRatio,
      gpu: this.gpuName
    };
    this.stats = createStatsWindow();
    if (stageStatsRequested()) reportStats(this.latestStats);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('scroll', this.invalidateLayout, true);
    for (const actor of this.actors.values()) {
      actor.mutations?.disconnect();
      actor.resizeObserver?.disconnect();
      actor.target.dispose();
    }
    this.actors.clear();
    this.compositePlane.geometry.dispose();
    this.compositeMaterial.dispose();
    this.renderer.dispose();
  }
}

function createStatsWindow() {
  return {
    startedAt: 0,
    frames: 0,
    frameMs: 0,
    updateMs: 0,
    drawMs: 0,
    texturePixels: 0,
    compositePixels: 0,
    drawCalls: 0,
    triangles: 0
  };
}

function readGpuName(renderer: THREE.WebGLRenderer): string {
  if (!stageStatsRequested()) return 'unknown';
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    if (!info) return 'unavailable';
    return String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
  } catch {
    return 'unavailable';
  }
}

/** Opt-in console reporting, so a shipped stage does not log every two seconds. */
function stageStatsRequested(): boolean {
  if (typeof location === 'undefined') return false;
  try {
    return new URLSearchParams(location.search).get('stageStats') === '1';
  } catch {
    return false;
  }
}

function reportStats(stats: StageStats): void {
  const megapixels = (pixels: number) => `${(pixels / 1_000_000).toFixed(2)} MPx`;
  console.info(
    `[stage] ${stats.framesPerSecond.toFixed(1)} fps` +
      ` · cpu ${stats.cpuMsPerFrame.toFixed(2)} ms/frame (update ${stats.cpuMsUpdating.toFixed(2)}, draw ${stats.cpuMsDrawing.toFixed(2)})` +
      ` · ${Math.round(stats.drawCallsPerFrame)} draw calls` +
      ` · ${Math.round(stats.trianglesPerFrame / 1000)}k tris` +
      ` · texture ${megapixels(stats.actorTexturePixelsPerFrame)}` +
      ` · composite ${megapixels(stats.compositePixelsPerFrame)}` +
      ` · ${stats.actors} actors · ratio ${stats.targetPixelRatio.toFixed(2)}` +
      ` · ${stats.gpu}`
  );
}
