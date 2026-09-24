export type MicroDynamicsTier = 'A' | 'B' | 'C';
export type MicroDynamicsEasing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

export interface MicroDynamicsKeyframe {
  at: number;
  value: number;
}

export interface MicroDynamicsTrack {
  target: string;
  keyframes: MicroDynamicsKeyframe[];
  randomSign?: boolean;
  startFromCurrent?: boolean;
}

export interface MicroDynamicsAction {
  id: string;
  label: string;
  tier: MicroDynamicsTier;
  description: string;
  durationMs: number;
  easing: MicroDynamicsEasing;
  tracks: MicroDynamicsTrack[];
}

export interface MicroDynamicsState {
  id: string;
  label: string;
  values: Record<string, number>;
}

export interface MicroDynamicsScheduleRule {
  action: string;
  intervalMs: [number, number];
  probability: number;
}

export interface MicroDynamicsConfig {
  version: 1;
  model: {
    url: string;
    camera: { fov: number; position: [number, number, number]; lookAt: [number, number, number] };
  };
  bindings: {
    expressions: Record<string, string>;
    morphs?: Record<string, string[]>;
    bones: Record<string, { node: string; axis: 'x' | 'y' | 'z' }>;
  };
  scheduler: {
    enabled: boolean;
    rules: MicroDynamicsScheduleRule[];
  };
  states: MicroDynamicsState[];
  actions: MicroDynamicsAction[];
}

export interface MicroDynamicsDiagnostics {
  expressionBindings: Array<{ logical: string; actual: string; available: boolean }>;
  boneBindings: Array<{ logical: string; actual: string; available: boolean }>;
}
