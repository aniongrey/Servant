import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createEmissiveDissolveEffect } from './EmissiveDissolveEffect';

describe('emissive dissolve shader', () => {
  it('restores ordinary rendering on completion and can summon the animated model again', () => {
    const material = new THREE.MeshBasicMaterial();
    const originalCompile = material.onBeforeCompile;
    const originalCacheKey = material.customProgramCacheKey;
    const root = new THREE.Mesh(new THREE.BoxGeometry(), material);
    const effect = createEmissiveDissolveEffect(root);
    effect.setProgress(1);
    // A later head/whole-body movement must not cross a lingering world-space glow band.
    root.position.y = 2;
    const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <project_vertex>', fragmentShader: '#include <common>\n#include <dithering_fragment>' } as never;
    material.onBeforeCompile(shader, {} as never);
    expect((shader as { fragmentShader: string }).fragmentShader).not.toContain('dissolve');
    expect(material.onBeforeCompile).toBe(originalCompile);
    expect(material.customProgramCacheKey).toBe(originalCacheKey);
    const completedVersion = material.version;
    effect.dispose();
    expect(material.version).toBe(completedVersion);

    const next = createEmissiveDissolveEffect(root);
    next.setProgress(0.5);
    material.onBeforeCompile(shader, {} as never);
    expect((shader as { fragmentShader: string }).fragmentShader).toContain('dissolveEdge');
    next.dispose();
    expect(material.onBeforeCompile).toBe(originalCompile);
  });

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
