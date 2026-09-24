import { expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { VisemeWeights } from 'three-vrm-lip-sync';
import { applyWheelZoom, updateLipSync } from './stageRendering';

it('zooms the camera with normalized wheel units and bounded magnification', () => {
  const camera = new PerspectiveCamera();
  const original = camera.projectionMatrix.clone();
  applyWheelZoom(camera, -100, 0, 760);
  expect(camera.zoom).toBeGreaterThan(1);
  expect(camera.projectionMatrix.equals(original)).toBe(false);
  camera.zoom = 1;
  applyWheelZoom(camera, -1, 1, 760);
  expect(camera.zoom).toBeCloseTo(Math.exp(0.016));
  applyWheelZoom(camera, -100, 2, 760);
  expect(camera.zoom).toBe(2.5);
  applyWheelZoom(camera, 100000, 0, 760);
  expect(camera.zoom).toBe(0.5);
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
