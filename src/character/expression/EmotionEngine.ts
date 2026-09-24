import type { EmotionState, RelationshipState, UserActionIntent } from '../../app/runtimeTypes';
import type { RuntimeStore } from '../../app/state/RuntimeStore';

interface EmotionDelta {
  emotions?: Partial<Record<keyof EmotionState, number>>;
  relationship?: Partial<Record<keyof RelationshipState, number>>;
}

const USER_ACTION_DELTAS: Record<UserActionIntent, EmotionDelta> = {
  missedPromise: {
    emotions: { anger: 0.45, sadness: 0.1, happiness: -0.22 }
  },
  comfort: {
    emotions: { anger: -0.12, happiness: 0.14, shyness: 0.03 },
    relationship: { trust: 0.05, attachment: 0.02 }
  },
  apology: {
    emotions: { anger: -0.2, happiness: 0.06 },
    relationship: { trust: 0.08 }
  },
  sincereApology: {
    emotions: { anger: -0.28, sadness: -0.04, happiness: 0.08 },
    relationship: { trust: 0.11, attachment: 0.02 }
  },
  emptyApology: {
    emotions: { anger: -0.04, sadness: 0.02 },
    relationship: { trust: -0.01 }
  },
  ignore: {
    emotions: { anger: 0.08, sadness: 0.08, happiness: -0.05 },
    relationship: { trust: -0.04 }
  },
  praise: {
    emotions: { happiness: 0.2, shyness: 0.12, anger: -0.05 },
    relationship: { attachment: 0.03 }
  },
  userReturn: {
    emotions: { happiness: 0.16, sadness: -0.05 },
    relationship: { attachment: 0.02 }
  },
  shyCompliment: {
    emotions: { shyness: 0.28, happiness: 0.12 },
    relationship: { attachment: 0.02 }
  },
  sadnessSpike: {
    emotions: { sadness: 0.36, happiness: -0.1 }
  },
  happyGift: {
    emotions: { happiness: 0.28, shyness: 0.06 },
    relationship: { attachment: 0.04 }
  },
  tailPoke: {
    emotions: { shyness: 0.1, anger: 0.04 }
  },
  workStart: {
    emotions: { happiness: 0.05 },
    relationship: { trust: 0.01 }
  },
  goodnight: {
    emotions: { sadness: -0.03, happiness: 0.04 },
    relationship: { attachment: 0.02 }
  },
  birthdayToday: {
    emotions: { happiness: 0.25, shyness: 0.08 },
    relationship: { attachment: 0.05 }
  },
  anniversaryToday: {
    emotions: { happiness: 0.24, shyness: 0.12 },
    relationship: { attachment: 0.06 }
  }
};

const ANGER_NATURAL_DECAY_PER_MINUTE = 0.002;

export class EmotionEngine {
  private decayAccumulatorMs = 0;

  constructor(private readonly store: RuntimeStore) {}

  applyUserAction(intent: UserActionIntent): void {
    const delta = USER_ACTION_DELTAS[intent];

    this.store.mutate((snapshot) => {
      if (delta.emotions) {
        for (const [key, value] of Object.entries(delta.emotions)) {
          const emotionKey = key as keyof EmotionState;
          snapshot.emotions[emotionKey] = clamp01(snapshot.emotions[emotionKey] + value);
        }
      }

      if (delta.relationship) {
        for (const [key, value] of Object.entries(delta.relationship)) {
          const relationshipKey = key as keyof RelationshipState;
          snapshot.relationship[relationshipKey] = clamp01(snapshot.relationship[relationshipKey] + value);
        }
      }

      if (intent === 'missedPromise') {
        snapshot.counters.comfortCount = 0;
      }

      if (
        intent === 'comfort' ||
        intent === 'apology' ||
        intent === 'sincereApology' ||
        intent === 'emptyApology'
      ) {
        snapshot.counters.comfortCount = (snapshot.counters.comfortCount ?? 0) + 1;
      }
    });

    this.store.appendLog(`Applied emotion action: ${intent}`);
  }

  tick(deltaSeconds: number): void {
    this.decayAccumulatorMs += deltaSeconds * 1000;
    if (this.decayAccumulatorMs < 10_000) {
      return;
    }

    const minutes = this.decayAccumulatorMs / 60_000;
    this.decayAccumulatorMs = 0;

    this.store.mutate((snapshot) => {
      snapshot.emotions.anger = clamp01(snapshot.emotions.anger - ANGER_NATURAL_DECAY_PER_MINUTE * minutes);
      snapshot.emotions.sadness = clamp01(snapshot.emotions.sadness - 0.003 * minutes);
      snapshot.emotions.shyness = clamp01(snapshot.emotions.shyness - 0.002 * minutes);
      snapshot.emotions.happiness = clamp01(
        snapshot.emotions.happiness + (0.48 - snapshot.emotions.happiness) * 0.006 * minutes
      );
    });
  }
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}
