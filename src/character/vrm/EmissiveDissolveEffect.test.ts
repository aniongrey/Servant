import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createEmissiveDissolveEffect } from './EmissiveDissolveEffect';

describe('emissive dissolve shader', () => {
  it('injects noise discard and restores the material hook', () => {
    const material = new THREE.MeshBasicMaterial();
    const original = material.onBeforeCompile;
    const root = new THREE.Mesh(new THREE.BoxGeometry(), material);
    const effect = createEmissiveDissolveEffect(root);
    const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <project_vertex>', fragmentShader: '#include <common>\n#include <dithering_fragment>' } as never;

    material.onBeforeCompile(shader, {} as never);
    expect((shader as { fragmentShader: string }).fragmentShader).toContain('dissolveNoise');
    expect((shader as { fragmentShader: string }).fragmentShader).toContain('discard');
    expect((shader as { fragmentShader: string }).fragmentShader).toContain('mix(uDissolveMinY - 0.08, uDissolveMaxY + 0.08, uDissolveProgress)');
    expect((shader as { fragmentShader: string }).fragmentShader).toContain('dissolveScan - vDissolveWorldPosition.y');

    effect.setProgress(2);
    effect.dispose();
    expect(material.onBeforeCompile).toBe(original);
  });
});
