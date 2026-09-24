export interface AvatarFitConfig {
  showGuide: boolean;
  height: number;
  shoulderWidth: number;
  armLength: number;
  wristRotationOffset: RotationOffsetConfig;
  footGroundOffset: number;
  colliders: AvatarColliderConfig;
  handIk: AvatarHandIkRule;
}

export interface RotationOffsetConfig {
  x: number;
  y: number;
  z: number;
}

export interface AvatarColliderConfig {
  head: AvatarHeadColliderConfig;
  torso: AvatarTorsoColliderConfig;
}

export interface AvatarHeadColliderConfig {
  radius: number;
  height: number;
}

export interface AvatarTorsoColliderConfig {
  topRadius: number;
  bottomRadius: number;
  topHeight: number;
  bottomHeight: number;
}

export interface AvatarHandIkRule {
  enabled: boolean;
  strength: number;
  iterations: number;
  margin: number;
  torsoPushMode: AvatarHandIkTorsoPushMode;
  frontPushMinHeight: number;
}

export type AvatarHandIkTorsoPushMode = 'radial' | 'front' | 'crossFront';

// Covers cocoa_0.0.0 2.vrm through VRM1_Constraint_Twist_Sample.vrm, rounded outward.
export const avatarFitRanges = {
  height: { min: 0.585, max: 1.815, step: 0.005 },
  shoulderWidth: { min: 0.063, max: 0.44, step: 0.001 },
  armLength: { min: 0.153, max: 0.605, step: 0.001 },
  footGroundOffset: { min: -0.198, max: 0.198, step: 0.001 },
  headRadius: { min: 0.018, max: 0.308, step: 0.001 },
  headHeight: { min: 0.36, max: 1.54, step: 0.005 },
  torsoRadius: { min: 0.018, max: 0.462, step: 0.001 },
  torsoTopHeight: { min: 0.27, max: 1.32, step: 0.005 },
  torsoBottomHeight: { min: 0.225, max: 1.045, step: 0.005 }
} as const;

export const defaultAvatarFitConfig: AvatarFitConfig = {
  showGuide: false,
  height: 1.55,
  shoulderWidth: 0.34,
  armLength: 0.52,
  wristRotationOffset: {
    x: 0,
    y: 0,
    z: 0
  },
  footGroundOffset: 0,
  colliders: {
    head: {
      radius: 0.11,
      height: 1.32
    },
    torso: {
      topRadius: 0.12,
      bottomRadius: 0.18,
      topHeight: 1.05,
      bottomHeight: 0.72
    }
  },
  handIk: {
    enabled: true,
    strength: 0.86,
    iterations: 4,
    margin: 0.025,
    torsoPushMode: 'radial',
    frontPushMinHeight: 0
  }
};

export function normalizeAvatarFitConfig(
  config: Partial<AvatarFitConfig> | undefined,
  fallback: AvatarFitConfig = defaultAvatarFitConfig
): AvatarFitConfig {
  return {
    showGuide: readConfigBoolean(config?.showGuide, fallback.showGuide),
    height: readConfigNumber(config?.height, fallback.height),
    shoulderWidth: readConfigNumber(config?.shoulderWidth, fallback.shoulderWidth),
    armLength: readConfigNumber(config?.armLength, fallback.armLength),
    footGroundOffset: readConfigNumber(config?.footGroundOffset, fallback.footGroundOffset),
    wristRotationOffset: {
      x: readConfigNumber(config?.wristRotationOffset?.x, fallback.wristRotationOffset.x),
      y: readConfigNumber(config?.wristRotationOffset?.y, fallback.wristRotationOffset.y),
      z: readConfigNumber(config?.wristRotationOffset?.z, fallback.wristRotationOffset.z)
    },
    colliders: normalizeColliderConfig(config?.colliders, fallback.colliders),
    handIk: normalizeHandIkRule(readHandIkRule(config?.handIk), fallback.handIk)
  };
}

function readConfigNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readConfigBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeHandIkRule(
  rule: Partial<AvatarHandIkRule> | undefined,
  fallback: AvatarHandIkRule
): AvatarHandIkRule {
  return {
    enabled: readConfigBoolean(rule?.enabled, fallback.enabled),
    strength: readConfigNumber(rule?.strength, fallback.strength),
    iterations: readConfigNumber(rule?.iterations, fallback.iterations),
    margin: readConfigNumber(rule?.margin, fallback.margin),
    torsoPushMode: readTorsoPushMode(rule?.torsoPushMode, fallback.torsoPushMode),
    frontPushMinHeight: readConfigNumber(rule?.frontPushMinHeight, fallback.frontPushMinHeight)
  };
}

function readTorsoPushMode(value: unknown, fallback: AvatarHandIkTorsoPushMode): AvatarHandIkTorsoPushMode {
  return value === 'front' || value === 'crossFront' || value === 'radial' ? value : fallback;
}

function readHandIkRule(value: unknown): Partial<AvatarHandIkRule> | undefined {
  const config = readObject<AvatarHandIkRule & { default?: Partial<AvatarHandIkRule> }>(value);
  return config?.default ?? config;
}

function normalizeColliderConfig(
  colliders: Partial<AvatarColliderConfig> | undefined,
  fallback: AvatarColliderConfig
): AvatarColliderConfig {
  return {
    head: normalizeHeadCollider(readObject(colliders?.head), fallback.head),
    torso: normalizeTorsoCollider(readObject(colliders?.torso), fallback.torso)
  };
}

function normalizeHeadCollider(
  head: Partial<AvatarHeadColliderConfig> | undefined,
  fallback: AvatarHeadColliderConfig
): AvatarHeadColliderConfig {
  return {
    radius: readConfigNumber(head?.radius, fallback.radius),
    height: readConfigNumber(head?.height, fallback.height)
  };
}

function normalizeTorsoCollider(
  torso: Partial<AvatarTorsoColliderConfig> | undefined,
  fallback: AvatarTorsoColliderConfig
): AvatarTorsoColliderConfig {
  return {
    topRadius: readConfigNumber(torso?.topRadius, fallback.topRadius),
    bottomRadius: readConfigNumber(torso?.bottomRadius, fallback.bottomRadius),
    topHeight: readConfigNumber(torso?.topHeight, fallback.topHeight),
    bottomHeight: readConfigNumber(torso?.bottomHeight, fallback.bottomHeight)
  };
}

function readObject<T extends object>(value: unknown): Partial<T> | undefined {
  return typeof value === 'object' && value !== null ? (value as Partial<T>) : undefined;
}
