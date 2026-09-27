import type { MmdAnimation } from '@yohawing/three-mmd-loader/parser';
import {
  createCustomBulletMmdPhysicsBackend,
  loadCustomBulletMmdModule,
  type CustomBulletMmdModule,
  type CustomBulletMmdPhysicsBackend
} from '@yohawing/three-mmd-loader/physics';

/**
 * PMX 的头发 / 裙子物理。
 *
 * 开关在 loader 的 runtime 选项上 —— `physics: "none" | "stateful-spring" | "external"`，
 * **默认 `"none"`**，这就是 PMX 接进来后头发和裙子完全不动的原因（VRM 侧本来也没有物理，
 * 但 VRM 模型的裙摆通常只靠 VRMA 带动，静态看不出问题；MMD 模型把整条裙子做成了刚体链，
 * 不动就非常显眼）。
 *
 * 这里选 `"external"` + 官方预编译的 Bullet：内置的 `"stateful-spring"` 只输出骨骼的
 * **平移**偏移（`StatefulSpringPhysicsSimulation` 的 offsets 是 3 分量，最终写回
 * `bone.position`，还被 clamp 到刚体尺寸的 0.35 倍），而头发/裙子摆动的本质是绕关节的
 * **旋转**，弹簧模式只能得到几乎看不出的位移。
 */

/** 胶水脚本用 `document.currentScript.src` 定位同目录的 `.wasm`，两个文件必须放一起。 */
const BULLET_SCRIPT_URL = '/assets/mmd-bullet/mmd_bullet.js';

let bulletModule: Promise<CustomBulletMmdModule> | undefined;

function loadBulletModule(): Promise<CustomBulletMmdModule> {
  // Emscripten 的 MODULARIZE 产物只能实例化一次，全局共用一个 module；
  // 每个角色各自持有一个 backend（一个 Bullet world）。
  bulletModule ??= loadCustomBulletMmdModule({ scriptUrl: BULLET_SCRIPT_URL }).catch((error: unknown) => {
    // 失败不缓存：一次网络抖动不该让物理在本进程内永久失效。
    bulletModule = undefined;
    throw error;
  });
  return bulletModule;
}

export interface MmdPhysicsBackendOptions {
  /** 覆盖 module 加载，测试用。 */
  readonly loadModule?: () => Promise<CustomBulletMmdModule>;
  /** 后端建不起来时的通知，默认 `console.warn`。 */
  readonly onUnavailable?: (error: unknown) => void;
}

/**
 * 建一个角色自己的 Bullet world。
 *
 * 物理是增强项：wasm 取不到就返回 `undefined`，让角色照常加载、头发裙子保持静止，
 * 而不是因为一个 350 KB 的资源把整个模型挡在门外。
 */
export async function createMmdPhysicsBackend(
  options: MmdPhysicsBackendOptions = {}
): Promise<CustomBulletMmdPhysicsBackend | undefined> {
  try {
    const module = await (options.loadModule ?? loadBulletModule)();
    return createCustomBulletMmdPhysicsBackend(module);
  } catch (error) {
    const report = options.onUnavailable
      ?? ((cause: unknown) => console.warn('MMD 物理后端不可用，头发与裙子将保持静止', cause));
    report(error);
    return undefined;
  }
}

/**
 * 绑定用的空动画。
 *
 * `MmdRuntime` 只在 `setAnimation` 里认领 mesh：它在这一步读 PMX 的刚体与关节，
 * 并把**当时**的姿态记成 rest（也就是物理的「静止位」）。所以纯物理驱动也得先塞一个
 * 动画进去。它没有 boneTracks，`applyMmdAnimation` 会把骨骼复位到那一刻的 rest 之后
 * 就跳过，不会覆盖 VRMA 或表情权重 —— 绑完立刻 `clearAnimation()`，此后每帧只剩物理。
 */
export const EMPTY_MMD_ANIMATION: MmdAnimation = {
  kind: 'vmd',
  bytes: new Uint8Array(0),
  metadata: {
    modelName: '',
    counts: { bones: 0, morphs: 0, cameras: 0, lights: 0, selfShadows: 0, properties: 0 },
    maxFrame: 0
  },
  boneTracks: {},
  morphTracks: {},
  cameraFrames: [],
  lightFrames: [],
  selfShadowFrames: [],
  propertyFrames: []
};
