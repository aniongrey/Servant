import type { CustomTrigger, RuntimeLogLevel, RuntimeSnapshot } from '../runtimeTypes';

export type RuntimeListener = () => void;

export class RuntimeStore {
  private snapshot: RuntimeSnapshot;
  private readonly listeners = new Set<RuntimeListener>();

  constructor(initialSnapshot?: Partial<RuntimeSnapshot>) {
    this.snapshot = normalizeSnapshot(initialSnapshot);
  }

  getSnapshot = (): RuntimeSnapshot => {
    return this.snapshot;
  };

  subscribe = (listener: RuntimeListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  patch(partial: Partial<RuntimeSnapshot>): void {
    this.snapshot = normalizeSnapshot({
      ...this.snapshot,
      ...partial
    });
    this.emit();
  }

  mutate(mutator: (snapshot: RuntimeSnapshot) => void): void {
    const next = cloneSnapshot(this.snapshot);
    mutator(next);
    this.snapshot = normalizeSnapshot(next);
    this.emit();
  }

  appendLog(message: string, level: RuntimeLogLevel = 'info'): void {
    this.snapshot = {
      ...this.snapshot,
      logs: [
        {
          at: Date.now(),
          level,
          message
        },
        ...this.snapshot.logs
      ].slice(0, 80)
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export function createInitialSnapshot(): RuntimeSnapshot {
  return {
    body: {
      phase: 'idle',
      activeLayers: {},
      loadedIds: [],
      lastFadeMs: 0
    },
    action: {
      activeActions: [],
      activeParts: {}
    },
    spatial: {
      x: 50,
      y: 50,
      scale: 1,
      facing: 'user',
      offscreen: false,
      tailVisible: false
    },
    expression: {
      id: 'neutral',
      weight: 0,
      gaze: 'user'
    },
    accessory: {
      preset: 'tail_idle'
    },
    fx: {
      active: {}
    },
    speech: {
      text: '',
      speaking: false,
      bubbleVisible: false
    },
    emotions: {
      anger: 0.18,
      sadness: 0.1,
      happiness: 0.48,
      shyness: 0.22
    },
    relationship: {
      trust: 0.54,
      attachment: 0.62
    },
    personality: {
      directAffection: 0.42,
      verbalDenial: 0.72,
      physicalLeak: 0.86,
      hideWhenShy: 0.68,
      needComfortWhenAngry: 0.74,
      teaseTolerance: 0.38
    },
    counters: {
      comfortCount: 0
    },
    customTriggers: createDefaultCustomTriggers(),
    customTriggerRuntime: {},
    trigger: {
      lastInput: ''
    },
    director: {
      currentStep: 0,
      totalSteps: 0,
      cooldowns: {}
    },
    logs: []
  };
}

export function createDefaultCustomTriggers(): CustomTrigger[] {
  return [
    {
      id: 'custom_welcome_home',
      userId: 'local',
      phrasePatterns: ['下班啦', '我回来了'],
      eventId: 'welcome_home_custom_01',
      cooldownMs: 10 * 60 * 1000,
      enabled: true,
      constraints: {
        minRelationship: 0.2,
        maxPerDay: 4
      }
    },
    {
      id: 'custom_work_start',
      userId: 'local',
      phrasePatterns: ['开工', '开始工作'],
      eventId: 'work_companion_01',
      cooldownMs: 5 * 60 * 1000,
      enabled: true
    },
    {
      id: 'custom_goodnight',
      userId: 'local',
      phrasePatterns: ['晚安', '睡觉啦'],
      eventId: 'goodnight_ritual_01',
      cooldownMs: 30 * 60 * 1000,
      enabled: true
    }
  ];
}

export function normalizeSnapshot(snapshot?: Partial<RuntimeSnapshot>): RuntimeSnapshot {
  const base = createInitialSnapshot();
  const merged: RuntimeSnapshot = {
    ...base,
    ...snapshot,
    body: {
      ...base.body,
      ...snapshot?.body,
      activeLayers: {
        ...base.body.activeLayers,
        ...snapshot?.body?.activeLayers
      }
    },
    action: {
      ...base.action,
      ...snapshot?.action,
      activeActions: snapshot?.action?.activeActions ?? base.action.activeActions,
      activeParts: {
        ...base.action.activeParts,
        ...snapshot?.action?.activeParts
      }
    },
    spatial: {
      ...base.spatial,
      ...snapshot?.spatial
    },
    expression: {
      ...base.expression,
      ...snapshot?.expression
    },
    accessory: {
      ...base.accessory,
      ...snapshot?.accessory
    },
    fx: {
      ...base.fx,
      ...snapshot?.fx
    },
    speech: {
      ...base.speech,
      ...snapshot?.speech
    },
    emotions: {
      ...base.emotions,
      ...snapshot?.emotions
    },
    relationship: {
      ...base.relationship,
      ...snapshot?.relationship
    },
    personality: {
      ...base.personality,
      ...snapshot?.personality
    },
    counters: {
      ...base.counters,
      ...snapshot?.counters
    },
    customTriggers: snapshot?.customTriggers ?? base.customTriggers,
    customTriggerRuntime: {
      ...base.customTriggerRuntime,
      ...snapshot?.customTriggerRuntime
    },
    trigger: {
      ...base.trigger,
      ...snapshot?.trigger
    },
    director: {
      ...base.director,
      ...snapshot?.director,
      cooldowns: {
        ...base.director.cooldowns,
        ...snapshot?.director?.cooldowns
      }
    },
    logs: snapshot?.logs ?? base.logs
  };

  return merged;
}

function cloneSnapshot(snapshot: RuntimeSnapshot): RuntimeSnapshot {
  return structuredClone(snapshot);
}
