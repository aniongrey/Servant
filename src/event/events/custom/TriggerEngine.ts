import type { EventDirector } from '../../EventDirector';
import type { EmotionEngine } from '../../../character/expression/EmotionEngine';
import type { RuntimeStore } from '../../../app/state/RuntimeStore';
import type { CustomTrigger, RuntimeContext, UserActionIntent } from '../../../app/runtimeTypes';

export interface CustomTriggerInput {
  phrasePatterns: string[];
  eventId: string;
  cooldownMs: number;
  userId?: string;
  enabled?: boolean;
  constraints?: CustomTrigger['constraints'];
}

export class TriggerEngine {
  constructor(
    private readonly store: RuntimeStore,
    private readonly director: EventDirector,
    private readonly emotion: EmotionEngine
  ) {}

  async fire(intent: UserActionIntent): Promise<void> {
    this.emotion.applyUserAction(intent);
    const eventId = this.eventForBuiltInIntent(intent);

    this.store.mutate((snapshot) => {
      snapshot.trigger.lastBuiltInTrigger = intent;
      snapshot.trigger.lastMatchedTrigger = undefined;
      snapshot.trigger.lastEventId = eventId;
    });

    if (eventId) {
      await this.director.play(eventId, contextFromStore(this.store), { force: true });
    }
  }

  async submitText(input: string, userId = 'local'): Promise<boolean> {
    const normalized = normalizeText(input);
    const trigger = this.store
      .getSnapshot()
      .customTriggers.find(
        (candidate) => candidate.userId === userId && matchesCustomTrigger(candidate, normalized)
      );

    if (!trigger) {
      this.store.mutate((snapshot) => {
        snapshot.trigger.lastInput = input;
        snapshot.trigger.lastMatchedTrigger = undefined;
      });
      this.store.appendLog(`No custom trigger matched: ${input}`, 'warn');
      return false;
    }

    if (!this.canUseCustomTrigger(trigger)) {
      this.store.appendLog(`Custom trigger blocked: ${trigger.id}`, 'warn');
      return false;
    }

    this.markCustomTriggerUsed(trigger.id);
    this.store.mutate((snapshot) => {
      snapshot.trigger.lastInput = input;
      snapshot.trigger.lastMatchedTrigger = trigger.id;
      snapshot.trigger.lastEventId = trigger.eventId;
    });

    await this.director.play(trigger.eventId, contextFromStore(this.store), { force: true });
    return true;
  }

  addCustomTrigger(input: CustomTriggerInput): CustomTrigger {
    const eventIds = new Set(this.director.listEvents().map((event) => event.id));
    if (!eventIds.has(input.eventId)) {
      throw new Error(`Unknown event for custom trigger: ${input.eventId}`);
    }

    const trigger: CustomTrigger = {
      id: `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      userId: input.userId ?? 'local',
      phrasePatterns: input.phrasePatterns.map((pattern) => pattern.trim()).filter(Boolean),
      eventId: input.eventId,
      cooldownMs: input.cooldownMs,
      enabled: input.enabled ?? true,
      constraints: input.constraints
    };

    this.store.mutate((snapshot) => {
      snapshot.customTriggers = [trigger, ...snapshot.customTriggers];
    });
    this.store.appendLog(`Added custom trigger: ${trigger.id}`);
    return trigger;
  }

  removeCustomTrigger(id: string): void {
    this.store.mutate((snapshot) => {
      snapshot.customTriggers = snapshot.customTriggers.filter((trigger) => trigger.id !== id);
      delete snapshot.customTriggerRuntime[id];
    });
    this.store.appendLog(`Removed custom trigger: ${id}`);
  }

  toggleCustomTrigger(id: string): void {
    this.store.mutate((snapshot) => {
      snapshot.customTriggers = snapshot.customTriggers.map((trigger) =>
        trigger.id === id
          ? {
              ...trigger,
              enabled: !trigger.enabled
            }
          : trigger
      );
    });
  }

  private eventForBuiltInIntent(intent: UserActionIntent): string | undefined {
    const snapshot = this.store.getSnapshot();

    switch (intent) {
      case 'missedPromise':
      case 'comfort':
      case 'apology':
      case 'sincereApology':
      case 'emptyApology':
        return 'angry_tsundere_001';
      case 'praise':
        return snapshot.emotions.shyness + snapshot.personality.hideWhenShy > 0.84
          ? 'shy_hide_screen_001'
          : 'daily_praise_001';
      case 'shyCompliment':
        return 'shy_hide_screen_001';
      case 'ignore':
      case 'sadnessSpike':
        return 'sad_water_001';
      case 'happyGift':
        return 'happy_overflow_001';
      case 'userReturn':
        return 'welcome_home_custom_01';
      case 'tailPoke':
        return 'tail_poke_peek_001';
      case 'workStart':
        return 'work_companion_01';
      case 'goodnight':
        return 'goodnight_ritual_01';
      case 'birthdayToday':
        return 'birthday_today_001';
      case 'anniversaryToday':
        return 'anniversary_today_001';
    }
  }

  private canUseCustomTrigger(trigger: CustomTrigger): boolean {
    if (!trigger.enabled) {
      return false;
    }

    const snapshot = this.store.getSnapshot();
    const runtime = snapshot.customTriggerRuntime[trigger.id];
    const now = Date.now();
    const dayKey = todayKey(now);

    if (runtime?.lastTriggeredAt && now - runtime.lastTriggeredAt < trigger.cooldownMs) {
      return false;
    }

    if (
      trigger.constraints?.maxPerDay &&
      runtime?.dayKey === dayKey &&
      runtime.countToday >= trigger.constraints.maxPerDay
    ) {
      return false;
    }

    if (trigger.constraints?.minRelationship !== undefined) {
      const relationshipScore = (snapshot.relationship.trust + snapshot.relationship.attachment) / 2;
      if (relationshipScore < trigger.constraints.minRelationship) {
        return false;
      }
    }

    if (trigger.constraints?.timeRange && !isNowInTimeRange(trigger.constraints.timeRange)) {
      return false;
    }

    return true;
  }

  private markCustomTriggerUsed(id: string): void {
    const now = Date.now();
    const dayKey = todayKey(now);

    this.store.mutate((snapshot) => {
      const current = snapshot.customTriggerRuntime[id];
      snapshot.customTriggerRuntime[id] = {
        dayKey,
        countToday: current?.dayKey === dayKey ? current.countToday + 1 : 1,
        lastTriggeredAt: now
      };
    });
  }
}

function matchesCustomTrigger(trigger: CustomTrigger, normalizedInput: string): boolean {
  if (!trigger.phrasePatterns || trigger.phrasePatterns.length === 0) {
    return false;
  }

  return trigger.phrasePatterns.some((pattern) => normalizedInput.includes(normalizeText(pattern)));
}

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function contextFromStore(store: RuntimeStore): RuntimeContext {
  const snapshot = store.getSnapshot();
  return {
    emotions: snapshot.emotions,
    relationship: snapshot.relationship,
    personality: snapshot.personality,
    counters: snapshot.counters
  };
}

function todayKey(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function isNowInTimeRange([start, end]: [string, string]): boolean {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = parseTime(start);
  const endMinutes = parseTime(end);

  if (startMinutes <= endMinutes) {
    return minutes >= startMinutes && minutes <= endMinutes;
  }

  return minutes >= startMinutes || minutes <= endMinutes;
}

function parseTime(value: string): number {
  const [hours = '0', minutes = '0'] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}
