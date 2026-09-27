import { expect, it, vi } from 'vitest';
import { Box3, PerspectiveCamera, Scene, Vector3 } from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { VisemeWeights } from 'three-vrm-lip-sync';
import { afterFirstStageRender, applyWheelZoom, fitStageCamera, setCameraZoomKeepingFootPosition, updateLipSync } from './stageRendering';

it('waits for the first draw before presentation and cancels readiness for an unloaded model', () => {
  const request = vi.fn();
  const cancel = vi.fn();
  vi.stubGlobal('requestAnimationFrame', request.mockReturnValue(7));
  vi.stubGlobal('cancelAnimationFrame', cancel);
  try {
    for (const abort of [false, true]) {
      const scene = new Scene();
      const original = scene.onAfterRender;
      const controller = new AbortController();
      const ready = vi.fn();
      request.mockClear();
      afterFirstStageRender(scene, controller.signal, ready);
      expect(ready).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
      // Three calls this hook after the actual draw, including initial GPU setup.
      scene.onAfterRender(...([] as unknown as Parameters<Scene['onAfterRender']>));
      expect(scene.onAfterRender).toBe(original);
      expect(ready).not.toHaveBeenCalled();
      if (abort) controller.abort();
      request.mock.calls[0][0](5000);
      expect(ready).toHaveBeenCalledTimes(abort ? 0 : 1);
      if (abort) expect(cancel).toHaveBeenCalledWith(7);
    }
    const scene = new Scene();
    const original = scene.onAfterRender;
    const controller = new AbortController();
    request.mockClear();
    afterFirstStageRender(scene, controller.signal, vi.fn());
    controller.abort();
    expect(scene.onAfterRender).toBe(original);
    expect(request).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('fits stage characters and keeps their head visible when changing to a half-body portrait', () => {
  const camera = new PerspectiveCamera(28, 0.8, 0.1, 20);
  camera.position.z = 3.4;
  const bounds = new Box3(new Vector3(-0.4, 0, -0.1), new Vector3(0.4, 1.7, 0.1));
  fitStageCamera(camera, bounds, 2);
  const head = () => new Vector3(0, 1.7, 0).project(camera).y;
  const foot = () => new Vector3(0, 0, 0).project(camera).y;
  expect(head()).toBeLessThan(1);
  expect(head()).toBeGreaterThan(0.5);
  expect(foot()).toBeGreaterThan(-1);
  const originalHead = head();
  fitStageCamera(camera, bounds, 3.5);
  expect(head()).toBeCloseTo(originalHead);
  expect(foot()).toBeLessThan(-1);
});

it('zooms the camera with normalized wheel units without artificial bounds', () => {
  const camera = new PerspectiveCamera();
  const original = camera.projectionMatrix.clone();
  applyWheelZoom(camera, -100, 0, 760, 0);
  expect(camera.zoom).toBeGreaterThan(1);
  expect(camera.projectionMatrix.equals(original)).toBe(false);
  camera.zoom = 1;
  applyWheelZoom(camera, -1, 1, 760);
  expect(camera.zoom).toBeCloseTo(Math.exp(0.016));
  applyWheelZoom(camera, -100, 2, 760);
  expect(Math.log(camera.zoom)).toBeCloseTo(76.016);
  applyWheelZoom(camera, 100000, 0, 760);
  expect(camera.zoom).toBeGreaterThan(0);
});

it('keeps the character foot at the same screen height while zooming', () => {
  const camera = new PerspectiveCamera(28, 1, 0.1, 20);
  camera.position.set(0, 0.78, 3.4);
  setCameraZoomKeepingFootPosition(camera, 1, 0.78);
  const footBefore = new Vector3(0, 0, 0).project(camera).y;

  applyWheelZoom(camera, -100, 0, 760, 0);

  expect(new Vector3(0, 0, 0).project(camera).y).toBeCloseTo(footBefore);
  expect(camera.zoom).toBeGreaterThan(1);
});

it('drives the mouth from analyser weights and skips visemes the model does not have', () => {
  const { vrm, weightsWritten } = createExpressionStub(['aa', 'ih', 'ou', 'ee']);
  const weights: VisemeWeights = { aa: 0.4, ih: 0.2, ou: 1.5, ee: 0, oh: 0.7 };

  updateLipSync(vrm, true, 12.5, weights);

  expect(weightsWritten.get('aa')).toBeCloseTo(0.4);
  expect(weightsWritten.get('ih')).toBeCloseTo(0.2);
  // Out-of-range weights are clamped rather than handed to the expression.
  expect(weightsWritten.get('ou')).toBe(1);
  expect(weightsWritten.get('ee')).toBe(0);
  // `oh` is missing on this model, so nothing may reference it.
  expect(weightsWritten.has('oh')).toBe(false);
  expect(weightsWritten.size).toBe(4);
});

it('only animates the speaking actor and clears the previous speaker when turns change', () => {
  const actors = Array.from({ length: 3 }, () => createExpressionStub(['aa', 'ih', 'ou', 'ee', 'oh']));
  const weights: VisemeWeights = { aa: 0.4, ih: 0.2, ou: 0.3, ee: 0.1, oh: 0.7 };

  for (const speaker of [0, 1, 2, -1]) {
    actors.forEach(({ vrm, weightsWritten }, index) => {
      updateLipSync(vrm, index === speaker, 12.5, weights);
      expect(Object.fromEntries(weightsWritten)).toEqual(
        index === speaker ? weights : { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }
      );
    });
  }
});

it('closes the mouth when the analyser reports silence, without waiting for `speaking`', () => {
  const { vrm, weightsWritten } = createExpressionStub(['aa', 'ih', 'ou', 'ee', 'oh']);

  updateLipSync(vrm, true, 4, { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 });

  expect(weightsWritten.get('aa')).toBe(0);
  expect(weightsWritten.get('oh')).toBe(0);
});

it('falls back to the procedural mouth and clears visemes the analyser left behind', () => {
  const { vrm, weightsWritten } = createExpressionStub(['aa', 'ih', 'ou', 'ee', 'oh']);

  updateLipSync(vrm, true, 0.1, null);

  expect(weightsWritten.get('aa')).toBeGreaterThan(0.2);
  // A leftover `ou` from an interrupted line would otherwise stay on the face.
  expect(weightsWritten.get('ou')).toBe(0);
  expect(weightsWritten.get('ih')).toBe(0);

  updateLipSync(vrm, false, 0.1, null);

  expect(weightsWritten.get('aa')).toBe(0);
});

function createExpressionStub(available: readonly string[]) {
  const weightsWritten = new Map<string, number>();
  const expressionManager = {
    getExpression: (name: string) => (available.includes(name) ? { name } : null),
    setValue: (name: string, weight: number) => weightsWritten.set(name, weight)
  };
  return {
    vrm: { expressionManager } as unknown as VRM,
    weightsWritten
  };
}
