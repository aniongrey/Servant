import type { EventDirector } from '../../EventDirector';
import type { RuntimeStore } from '../../../app/state/RuntimeStore';
import type { RuntimeContext } from '../../../app/runtimeTypes';
import type { GameEvent, GameEventReactionRule } from './types';

export class GameEventReactionDispatcher {
  constructor(
    private readonly rules: GameEventReactionRule[],
    private readonly director: EventDirector,
    private readonly store: RuntimeStore
  ) {}

  async dispatch(event: GameEvent): Promise<boolean> {
    const rule = this.findRule(event);
    if (!rule) {
      this.store.appendLog(`No reaction rule for ${event.game}:${event.type}`, 'warn');
      return false;
    }

    await this.director.play(rule.eventId, this.contextFromStore(), { force: true });
    return true;
  }

  private findRule(event: GameEvent): GameEventReactionRule | undefined {
    return this.rules
      .filter((rule) => matchesRule(rule, event))
      .sort((left, right) => right.priority - left.priority)[0];
  }

  private contextFromStore(): RuntimeContext {
    const snapshot = this.store.getSnapshot();
    return {
      emotions: snapshot.emotions,
      relationship: snapshot.relationship,
      personality: snapshot.personality,
      counters: snapshot.counters
    };
  }
}

function matchesRule(rule: GameEventReactionRule, event: GameEvent): boolean {
  if (rule.game !== event.game || rule.type !== event.type) {
    return false;
  }

  if (rule.item && normalize(rule.item) !== normalize(event.item)) {
    return false;
  }

  if (rule.area && normalize(rule.area) !== normalize(event.area)) {
    return false;
  }

  return true;
}

function normalize(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? '';
}
