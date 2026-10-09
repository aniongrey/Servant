import * as THREE from 'three';
import { VRMUtils, type VRM } from '@pixiv/three-vrm';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { throwIfAborted } from '../../../app/utils/delay';
import type { ActionBehaviorId, ActionBehaviorPlayer } from './actionBehaviors';

/** Owns per-character props, including cancelled loads and model teardown. */
export class CharacterActionBehaviors implements ActionBehaviorPlayer {
  private token = 0;
  private mount?: THREE.Group;
  private anchor?: THREE.Group;
  private animation?: { elapsed: number; duration: number; height: number; finish(): void };
  private cancel?: () => void;

  constructor(private readonly vrm: VRM,
    private readonly load = async () => (await new GLTFLoader().loadAsync('/assets/props/prop_iron_basin.glb')).scene) {}

  async play(id: ActionBehaviorId, durationSeconds: number, signal: AbortSignal): Promise<void> {
    if (id !== 'wear_iron_basin') throw new Error('未知动作行为：' + id);
    throwIfAborted(signal);
    const head = this.vrm.humanoid.getRawBoneNode('head');
    if (!head) throw new Error('角色缺少头部骨骼，无法戴锅');
    this.clear();
    const token = this.token;
    const prop = await this.load();
    if (signal.aborted || token !== this.token) {
      VRMUtils.deepDispose(prop);
      throwIfAborted(signal);
      return;
    }
    const mount = new THREE.Group();
    mount.name = 'action:wear_iron_basin';
    const anchor = new THREE.Group();
    mount.add(anchor);
    this.vrm.scene.updateMatrixWorld(true);
    mount.quaternion.copy(head.getWorldQuaternion(new THREE.Quaternion())).invert()
      .multiply(this.vrm.scene.getWorldQuaternion(new THREE.Quaternion()));
    const scale = head.getWorldScale(new THREE.Vector3());
    const neck = this.vrm.humanoid.getRawBoneNode('neck');
    const height = neck
      ? Math.max(0.08, head.getWorldPosition(new THREE.Vector3()).distanceTo(neck.getWorldPosition(new THREE.Vector3())) * 2.3 / scale.y)
      : 0.22;
    // The supplied GLB is Y-up; invert the pot so its opening faces the head.
    prop.rotation.x = Math.PI;
    prop.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(prop);
    const size = bounds.getSize(new THREE.Vector3());
    const width = Math.max(size.x, size.z);
    if (!Number.isFinite(width) || width <= 0) {
      VRMUtils.deepDispose(prop);
      throw new Error('不锈钢锅模型尺寸无效');
    }
    const fit = height * 2.2 / width;
    prop.scale.multiplyScalar(fit);
    prop.position.set(-(bounds.min.x + bounds.max.x) * fit / 2, -bounds.min.y * fit,
      -(bounds.min.z + bounds.max.z) * fit / 2);
    anchor.add(prop);
    head.add(mount);
    this.mount = mount;
    this.anchor = anchor;
    const cancel = () => this.clear();
    this.cancel = () => signal.removeEventListener('abort', cancel);
    signal.addEventListener('abort', cancel, { once: true });
    this.animation = { elapsed: 0, duration: Math.max(0.1, durationSeconds * 0.8), height,
      finish: () => { this.cancel?.(); this.cancel = undefined; } };
    this.update(0);
  }

  update(deltaSeconds: number): void {
    const animation = this.animation;
    if (!animation || !this.anchor) return;
    animation.elapsed += deltaSeconds;
    const t = THREE.MathUtils.clamp(animation.elapsed / animation.duration, 0, 1);
    // shortcut: lift follows the existing clip without hand contact; add grip targets for precise handling.
    const lift = THREE.MathUtils.smoothstep(t, 0, 0.7);
    const settle = THREE.MathUtils.smoothstep(t, 0.7, 1);
    this.anchor.position.set(0,
      animation.height * (-1.8 + 3.2 * lift - 0.25 * settle),
      animation.height * 1.6 * (1 - lift));
    if (t === 1) { animation.finish(); this.animation = undefined; }
  }

  clear(): void {
    this.token += 1;
    this.cancel?.(); this.cancel = undefined;
    this.animation = undefined;
    if (this.mount) {
      this.mount.removeFromParent();
      VRMUtils.deepDispose(this.mount);
      this.mount = undefined;
      this.anchor = undefined;
    }
  }
}
