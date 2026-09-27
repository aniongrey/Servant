import * as THREE from 'three';

export interface StageRenderActor {
  id: string;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  viewport: HTMLElement;
  update(deltaSeconds: number, nowSeconds: number): void;
  updateRate(): number;
}
type RenderEntry = StageRenderActor & { target: THREE.WebGLRenderTarget; dirty: boolean; lastUpdate: number };

/** One WebGL context and animation clock for all desktop actors. */
export class SharedStageRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly actors = new Map<string, RenderEntry>();
  private readonly compositeScene = new THREE.Scene();
  private readonly compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  private readonly compositeMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false });
  private readonly compositePlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMaterial);
  private frame = 0;
  private previous = performance.now();
  private previousRender = 0;
  private targetPixelRatio = 1;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;
    this.compositeCamera.position.z = 1;
    this.compositeScene.add(this.compositePlane);
    this.resize();
    window.addEventListener('resize', this.resize);
    this.frame = requestAnimationFrame(this.tick);
  }

  register(actor: StageRenderActor): () => void {
    const entry: RenderEntry = { ...actor, target: new THREE.WebGLRenderTarget(1, 1), dirty: true, lastUpdate: 0 };
    entry.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.actors.set(actor.id, entry);
    this.resizeTargets();
    this.resizeActor(actor);
    return () => {
      this.actors.delete(actor.id);
      entry.target.dispose();
      this.resizeTargets();
    };
  }

  get webglRenderer(): THREE.WebGLRenderer { return this.renderer; }

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
  }

  resizeActor(actor: StageRenderActor): void {
    const { width, height } = actor.viewport.getBoundingClientRect();
    actor.camera.aspect = width / Math.max(1, height);
    actor.camera.updateProjectionMatrix();
    const entry = this.actors.get(actor.id);
    if (entry) entry.dirty = true;
  }

  invalidate(id: string): void { const actor = this.actors.get(id); if (actor) actor.dirty = true; }

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

  private tick = (time: number): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
    if (document.visibilityState === 'hidden') return;
    const rate = Math.max(1, ...[...this.actors.values()].map((actor) => actor.updateRate()));
    if (time - this.previousRender < 1000 / rate) return;
    const delta = Math.min(0.1, Math.max(0, (time - this.previous) / 1000));
    this.previous = time;
    this.previousRender = time;
    const now = time / 1000;
    const rect = this.canvas.getBoundingClientRect();
    this.renderer.setScissorTest(false);
    this.renderer.clear(true, true, true);
    this.renderer.setScissorTest(true);
    const layer = (actor: StageRenderActor) => Number(actor.viewport.closest('.desktop-cast-actor')?.getAttribute('data-layer') || actor.viewport.style.zIndex || 0);
    const actors = [...this.actors.values()].sort((a, b) => layer(a) - layer(b));
    for (const actor of actors) {
      const bounds = actor.viewport.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0 || bounds.right <= rect.left || bounds.left >= rect.right || bounds.bottom <= rect.top || bounds.top >= rect.bottom) continue;
      const step = 1 / Math.max(1, actor.updateRate());
      const last = actor.lastUpdate;
      if (now - actor.lastUpdate >= step || actor.lastUpdate === 0) {
        let elapsed = Math.min(0.1, now - last || delta);
        actor.lastUpdate = now;
        while (elapsed > 0) {
          const stepDelta = Math.min(0.05, elapsed);
          actor.update(stepDelta, now - elapsed + stepDelta);
          elapsed -= stepDelta;
        }
        actor.dirty = true;
      }
      const left = bounds.left - rect.left;
      const bottom = rect.bottom - bounds.bottom;
      const width = bounds.width;
      const height = bounds.height;
      this.renderer.setViewport(left, bottom, width, height);
      this.renderer.setScissor(
        Math.max(0, left), Math.max(0, bottom),
        Math.max(0, Math.min(rect.width, left + width) - Math.max(0, left)),
        Math.max(0, Math.min(rect.height, bottom + height) - Math.max(0, bottom))
      );
      if (actor.dirty) {
        this.renderer.setRenderTarget(actor.target);
        this.renderer.setScissorTest(false);
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.clear(true, true, true);
        this.renderer.render(actor.scene, actor.camera);
        this.renderer.setRenderTarget(null);
        this.renderer.setScissorTest(true);
        actor.dirty = false;
      }
      this.compositeMaterial.map = actor.target.texture;
      this.renderer.render(this.compositeScene, this.compositeCamera);
    }
    this.renderer.setScissorTest(false);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    window.removeEventListener('resize', this.resize);
    for (const actor of this.actors.values()) actor.target.dispose();
    this.actors.clear();
    this.compositePlane.geometry.dispose();
    this.compositeMaterial.dispose();
    this.renderer.dispose();
  }
}
