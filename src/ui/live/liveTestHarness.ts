import {
  BlacklistManager,
  LocalStorageBlacklistStorage
} from '../../integrations/barrage/blacklist/BlacklistManager';
import { liveConfig, type LiveConfig } from '../../integrations/barrage/config/live.config';
import type { LiveEvent, LiveEventConsumer } from '../../integrations/barrage/events/LiveEvent';
import type { LiveLogCategory, LiveLogger } from '../../integrations/barrage/logger/LiveLogger';
import { LiveSystem } from '../../integrations/barrage/LiveSystem';
import { loadFilterRules } from './liveTestFilterRules';
import { describeEvent, formatProcessResult } from './liveTestFormat';
export interface ActivityEntry {
  id: number;
  time: number;
  category: LiveLogCategory | 'LIVE_INPUT';
  message: string;
  event?: LiveEvent;
}

export interface TestHarness {
  system: LiveSystem;
  responses: LiveEvent[];
  activity: ActivityEntry[];
  config: LiveConfig;
  setOnChange(listener?: () => void): void;
  tick(): Promise<void>;
  ingest(raw: unknown): ReturnType<LiveSystem['ingestRaw']>;
  clearResponses(): void;
  clearActivity(): void;
  addActivity(category: ActivityEntry['category'], message: string, event?: LiveEvent): void;
}

export function createHarness(): TestHarness {
  let onChange: (() => void) | undefined;
  let tickBusy = false;
  const render = () => onChange?.();
  const responses: LiveEvent[] = [];
  const activity: ActivityEntry[] = [];
  let nextActivityId = 1;
  const addActivity = (category: ActivityEntry['category'], message: string, event?: LiveEvent) => {
    activity.push({ id: nextActivityId++, time: Date.now(), category, message, event });
    if (activity.length > 300) activity.shift();
  };
  const logger: LiveLogger = {
    log(category, message, details) {
      addActivity(category, message, isLiveEvent(details) ? details : undefined);
      render();
    }
  };
  const consumer: LiveEventConsumer = {
    async handleLiveEvent(event) {
      responses.push(event);
      addActivity('LIVE_RESPONSE', describeEvent(event), event);
      render();
    }
  };
  const blacklist = new BlacklistManager(new LocalStorageBlacklistStorage());
  const config: LiveConfig = {
    ...liveConfig,
    barrageGrab: { ...liveConfig.barrageGrab },
    queue: { ...liveConfig.queue },
    controller: { ...liveConfig.controller },
    aggregation: { ...liveConfig.aggregation },
    filter: { ...liveConfig.filter, rules: loadFilterRules() },
    ttl: { ...liveConfig.ttl },
    petNames: [...liveConfig.petNames]
  };
  const system = new LiveSystem(consumer, config, logger, blacklist);
  return {
    system,
    responses,
    activity,
    config,
    addActivity,
    setOnChange(listener) {
      onChange = listener;
    },
    async tick() {
      if (tickBusy) return;
      tickBusy = true;
      try {
        await system.tick();
      } catch (error) {
        addActivity('LIVE_ERROR', error instanceof Error ? error.message : '调度失败');
      } finally {
        tickBusy = false;
        render();
      }
    },
    ingest(raw) {
      const result = system.ingestRaw(raw);
      addActivity('LIVE_INPUT', formatProcessResult(result), result.event);
      render();
      return result;
    },
    clearResponses() {
      responses.splice(0);
      render();
    },
    clearActivity() {
      activity.splice(0);
      render();
    }
  };
}

function isLiveEvent(value: unknown): value is LiveEvent {
  return typeof value === 'object' && value !== null && 'id' in value && 'priority' in value;
}
