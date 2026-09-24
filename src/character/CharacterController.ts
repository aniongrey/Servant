import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { VRMLookAtQuaternionProxy } from '@pixiv/three-vrm-animation';
import { ProceduralAccessoryAnimator, type CharacterRigConfig } from './motion/ProceduralAccessoryAnimator';
import { ThreeSpatialPlaybackAdapter } from './motion/ThreeSpatialPlaybackAdapter';
import { ThreeBodyMotionPlaybackAdapter } from './motion/ThreeBodyMotionPlaybackAdapter';
import { ProceduralHoldMotionAnimator } from './motion/ProceduralHoldMotionAnimator';
import { ProceduralFootIkAnimator } from './ik/ProceduralFootIkAnimator';
import {
  VrmExpressionPlaybackAdapter,
  VrmGazePlaybackAdapter
} from './expression/VrmExpressionPlaybackAdapter';
import { createAgentRuntime, type CreateAgentRuntimeOptions, type AgentRuntime } from '../ai/AgentRuntime';
import { VrmaLoader, type VrmaLoaderOptions } from './motion/VrmaLoader';
import { MicroDynamicsRuntime } from './micro-dynamics/MicroDynamicsRuntime';
import { parseMicroDynamicsConfig } from './micro-dynamics/config';
import microConfig from './micro-dynamics/micro-dynamics.json';
import actionConfig from './motion/assets/actions/full-body-motion-config.json';

export interface CreateCharacterControllerOptions
  extends Omit<
    CreateAgentRuntimeOptions,
    | 'motionLoader'
    | 'bodyPlaybackAdapter'
    | 'expressionPlaybackAdapter'
    | 'gazePlaybackAdapter'
    | 'accessoryPlaybackAdapter'
    | 'spatialPlaybackAdapter'
  > {
  vrmaLoader?: VrmaLoaderOptions;
  mixerRoot?: THREE.Object3D;
  spatialRoot?: THREE.Object3D;
  accessoryRig?: CharacterRigConfig;
  spatialBaseRotationY?: number;
  holdMicroMotionEnabled?: boolean;
  footIkEnabled?: boolean;
  getFootGroundOffset?: () => number;
}

export interface CharacterController extends AgentRuntime {
  mixer: THREE.AnimationMixer;
  microdynamics: MicroDynamicsRuntime;
  setHoldMicroMotionEnabled(enabled: boolean): void;
  setFootIkEnabled(enabled: boolean): void;
}

export function createCharacterController(
  vrm: VRM,
  options: CreateCharacterControllerOptions = {}
): CharacterController {
  const mixer = new THREE.AnimationMixer(options.mixerRoot ?? vrm.scene);
  const playbackAdapter = new ThreeBodyMotionPlaybackAdapter(
    mixer,
    new ProceduralHoldMotionAnimator(vrm, options.holdMicroMotionEnabled),
    new ProceduralFootIkAnimator(vrm, {
      enabled: options.footIkEnabled,
      getGroundOffset: options.getFootGroundOffset
    })
  );
  ensureLookAtQuaternionProxy(vrm);
  const accessoryAnimator = new ProceduralAccessoryAnimator(
    vrm.scene,
    options.accessoryRig ?? {
      tailBones: [],
      earBones: []
    }
  );
  const expressionAdapter = new VrmExpressionPlaybackAdapter(vrm);
  const engine = createAgentRuntime({
    ...options,
    motionLoader: new VrmaLoader(vrm, options.vrmaLoader),
    bodyPlaybackAdapter: playbackAdapter,
    expressionPlaybackAdapter: expressionAdapter,
    gazePlaybackAdapter: new VrmGazePlaybackAdapter(vrm),
    accessoryPlaybackAdapter: accessoryAnimator,
    spatialPlaybackAdapter: new ThreeSpatialPlaybackAdapter(
      options.spatialRoot ?? vrm.scene,
      options.spatialBaseRotationY
    )
  });
  const microdynamics = new MicroDynamicsRuntime(vrm, parseMicroDynamicsConfig({
    ...microConfig, scheduler: actionConfig.microdynamicsSchedule
  }), true);
  microdynamics.setAutoEnabled(true);
  engine.actionRuntime.setMicroDynamics(microdynamics);

  return {
    ...engine,
    mixer,
    microdynamics,
    setHoldMicroMotionEnabled(enabled: boolean) {
      playbackAdapter.setHoldMicroMotionEnabled(enabled);
    },
    setFootIkEnabled(enabled: boolean) {
      playbackAdapter.setFootIkEnabled(enabled);
    },
    update(deltaSeconds: number) {
      engine.update(deltaSeconds);
      const expression = engine.store.getSnapshot().expression;
      expressionAdapter.setExpression(expression.id, expression.weight);
      microdynamics.update(deltaSeconds);
      vrm.update(deltaSeconds);
    }
  };
}

function ensureLookAtQuaternionProxy(vrm: VRM): void {
  if (!vrm.lookAt) {
    return;
  }

  const hasProxy = vrm.scene.children.some((object) => object instanceof VRMLookAtQuaternionProxy);
  if (hasProxy) {
    return;
  }

  const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
  proxy.name = 'VRMLookAtQuaternionProxy';
  vrm.scene.add(proxy);
}
