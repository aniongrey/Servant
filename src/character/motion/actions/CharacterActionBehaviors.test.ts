import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { CharacterActionBehaviors } from './CharacterActionBehaviors';

function fixture() {
  const scene = new THREE.Group();
  const head = new THREE.Group(); head.position.y = 1.5; scene.add(head);
  const neck = new THREE.Group(); neck.position.y = 1.4; scene.add(neck);
  const prop = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2), new THREE.MeshStandardMaterial());
  prop.add(mesh);
  const vrm = { scene, humanoid: { getRawBoneNode: (id: string) => id === 'head' ? head : neck } } as unknown as VRM;
  return { scene, head, prop, mesh, vrm };
}

describe('CharacterActionBehaviors', () => {
  it('lifts an actual prop, seats it on the head, follows head motion and clears resources', async () => {
    const { head, prop, mesh, vrm } = fixture();
    const dispose = vi.spyOn(mesh.geometry, 'dispose');
    const player = new CharacterActionBehaviors(vrm, async () => prop);
    const controller = new AbortController();
    await player.play('wear_iron_basin', 4, controller.signal);
    const anchor = head.children[0].children[0];
    expect(anchor.children).toContain(prop);
    expect(anchor.position.y).toBeLessThan(0);
    player.update(4);
    expect(anchor.position.y).toBeGreaterThan(0);
    expect(anchor.position.z).toBe(0);
    const before = anchor.getWorldPosition(new THREE.Vector3());
    head.position.x += 2;
    expect(anchor.getWorldPosition(new THREE.Vector3()).x).toBeCloseTo(before.x + 2);
    // Once equipped, ending the one-shot does not remove the hat.
    controller.abort();
    expect(head.children).toHaveLength(1);
    player.clear();
    expect(head.children).toHaveLength(0);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('uses model-up even when the raw head bone has a reversed local axis', async () => {
    const { head, prop, vrm } = fixture();
    head.rotation.z = Math.PI;
    const player = new CharacterActionBehaviors(vrm, async () => prop);
    await player.play('wear_iron_basin', 4, new AbortController().signal);
    player.update(4);
    const carrier = head.children[0].children[0];
    expect(carrier.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(head.getWorldPosition(new THREE.Vector3()).y);
    player.clear();
  });

  it('removes an interrupted lift', async () => {
    const { head, prop, vrm } = fixture();
    const player = new CharacterActionBehaviors(vrm, async () => prop);
    const controller = new AbortController();
    await player.play('wear_iron_basin', 4, controller.signal);
    controller.abort();
    expect(head.children).toHaveLength(0);
  });

  it('disposes an aborted or superseded load without attaching it', async () => {
    const { head, prop, mesh, vrm } = fixture();
    let resolve!: (value: THREE.Group) => void;
    const dispose = vi.spyOn(mesh.geometry, 'dispose');
    const player = new CharacterActionBehaviors(vrm, () => new Promise<THREE.Group>((done) => { resolve = done; }));
    const controller = new AbortController();
    const pending = player.play('wear_iron_basin', 4, controller.signal);
    controller.abort(); resolve(prop);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(head.children).toHaveLength(0);
    expect(dispose).toHaveBeenCalledOnce();
    const pendingClear = player.play('wear_iron_basin', 4, new AbortController().signal);
    player.clear(); resolve(fixture().prop);
    await pendingClear;
    expect(head.children).toHaveLength(0);
  });
});
