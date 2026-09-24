import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DuplicateAggregator } from './aggregate/DuplicateAggregator';
import { BlacklistManager, MemoryBlacklistStorage } from './blacklist/BlacklistManager';
import { liveConfig, type LiveConfig } from './config/live.config.ts';
import { LiveController } from './controller/LiveController';
import { MockLiveEventConsumer } from './controller/MockLiveEventConsumer';
import { LiveEventNormalizer } from './events/LiveEventNormalizer';
import type { LiveEvent } from './events/LiveEvent';
import { LiveContentFilter } from './filter/LiveContentFilter';
import { LiveSystem } from './LiveSystem';
import { LivePriorityCalculator } from './priority/LivePriorityCalculator';
import { LiveEventQueue } from './queue/LiveEventQueue';

describe('LiveEventNormalizer', () => {
  it('normalizes Bilibili danmaku payloads', () => {
    const event = new LiveEventNormalizer(testConfig()).normalize({
      platform: 'bilibili',
      type: 'DANMU_MSG',
      user: { uid: 123, uname: '小明' },
      msg: '白白今天好可爱',
      ts: 1000
    });

    expect(event).toMatchObject({
      platform: 'bilibili',
      type: 'danmaku',
      user: { id: '123', name: '小明' },
      content: '白白今天好可爱',
      timestamp: 1000
    });
  });

  it('normalizes Douyin danmaku payloads', () => {
    const event = new LiveEventNormalizer(testConfig()).normalize({
      source: 'douyin',
      event: 'chat',
      user: { userId: '456', nickname: '小红' },
      text: '宠物叫什么？',
      timestamp: 2000
    });

    expect(event).toMatchObject({
      platform: 'douyin',
      type: 'danmaku',
      user: { id: '456', name: '小红' },
      content: '宠物叫什么？',
      timestamp: 2000
    });
  });

  it('drops unrecognized raw events', () => {
    expect(new LiveEventNormalizer(testConfig()).normalize({ hello: 'world' })).toBeUndefined();
  });
});

describe('BlacklistManager and LiveContentFilter', () => {
  it('drops ignore users before priority and queue', async () => {
    const blacklist = new BlacklistManager(new MemoryBlacklistStorage());
    await blacklist.load();
    await blacklist.add({ platform: 'bilibili', userId: 'user123', mode: 'ignore', reason: 'spam' });

    const result = blacklist.apply(liveEvent({ userId: 'user123', content: '白白回答我！' }));

    expect(result.action).toBe('drop');
  });

  it('marks no_ai_response users without dropping UI-visible events', async () => {
    const blacklist = new BlacklistManager(new MemoryBlacklistStorage());
    await blacklist.load();
    await blacklist.add({ platform: 'bilibili', userId: 'user456', mode: 'no_ai_response' });

    const result = blacklist.apply(liveEvent({ userId: 'user456', content: '白白回答我！' }));

    expect(result.action).toBe('allow');
    expect(result.event?.metadata?.noAiResponse).toBe(true);
  });

  it('expires temporary blacklist entries', async () => {
    vi.setSystemTime(5000);
    const blacklist = new BlacklistManager(new MemoryBlacklistStorage());
    await blacklist.load();
    await blacklist.add({ platform: 'bilibili', userId: 'temp', mode: 'ignore', expiresAt: 4000 });

    expect(blacklist.has('bilibili', 'temp')).toBe(false);
  });

  it('supports keyword hide, regex ignore_ai, and spam penalty', () => {
    const filter = new LiveContentFilter(
      testConfig({
        filter: {
          ...liveConfig.filter,
          spamWindowMs: 3000,
          spamMaxMessages: 5,
          rules: [
            { id: 'blocked-word', type: 'keyword', value: '屏蔽', action: 'hide', enabled: true },
            { id: 'url', type: 'regex', value: 'https?://', action: 'ignore_ai', enabled: true }
          ]
        }
      })
    );

    expect(filter.apply(liveEvent({ content: '请屏蔽这个' }), 1000).action).toBe('drop');
    expect(
      filter.apply(liveEvent({ content: '看 http://example.test' }), 1100).event?.metadata?.noAiResponse
    ).toBe(true);

    let result = filter.apply(liveEvent({ userId: 'spammer', content: '刷' }), 1200);
    for (let index = 0; index < 5; index += 1) {
      result = filter.apply(liveEvent({ userId: 'spammer', content: '刷' }), 1300 + index);
    }
    expect(result.event?.metadata?.isSpam).toBe(true);
    expect(result.event?.priority).toBe(20);
  });
});

describe('Live priority, aggregation, queue, and controller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
  });

  it('aggregates duplicate danmaku and promotes many unique users', () => {
    const config = testConfig();
    const aggregator = new DuplicateAggregator(config);
    const priority = new LivePriorityCalculator(config);
    let event = liveEvent({ userId: 'u0', content: '主播后面！', timestamp: 100000 });

    for (let index = 0; index < 30; index += 1) {
      event = aggregator.apply(
        liveEvent({ userId: `u${index}`, content: '主播后面！', timestamp: 100000 + index }),
        100000 + index
      );
    }
    const prioritized = priority.calculate(event, { now: 100000 });

    expect(prioritized.metadata?.aggregation).toMatchObject({ count: 30, uniqueUsers: 30 });
    expect(prioritized.priority).toBe(90);
  });

  it('moves an aggregated event between bands without leaving stale copies', () => {
    const queue = new LiveEventQueue(testConfig());
    const aggregation = {
      key: 'same',
      content: '主播后面！',
      count: 1,
      uniqueUsers: 1,
      firstTimestamp: 100000,
      lastTimestamp: 100000
    };
    const low = {
      ...liveEvent({ id: 'same-low', content: '主播后面！', priority: 20 }),
      metadata: { aggregation }
    };
    const normal = {
      ...low,
      priority: 50,
      metadata: { aggregation: { ...aggregation, count: 10, uniqueUsers: 10 } }
    };
    const high = {
      ...low,
      priority: 90,
      metadata: { aggregation: { ...aggregation, count: 30, uniqueUsers: 30 } }
    };

    queue.add(low);
    queue.add(normal);
    queue.add(high);

    expect(queue.getSnapshot()).toEqual({ high: 1, normal: 0, low: 0 });
    expect(queue.high[0].metadata?.aggregation?.uniqueUsers).toBe(30);
  });

  it('routes pet-name questions to high and low-value text to low', () => {
    const priority = new LivePriorityCalculator(testConfig());
    const high = priority.calculate(liveEvent({ content: '白白你喜欢主播吗？', timestamp: 100000 }), {
      now: 100000
    });
    const low = priority.calculate(liveEvent({ content: '666', timestamp: 100000 }), { now: 100000 });
    const queue = new LiveEventQueue(testConfig());

    expect(queue.add(high)).toBe('high');
    expect(queue.add(low)).toBe('low');
  });

  it('clears TTL-expired events', () => {
    const queue = new LiveEventQueue(testConfig());
    queue.add({ ...liveEvent({ content: '快过期', timestamp: 100000 }), expiresAt: 108000 });

    expect(queue.clearExpired(108001)).toBe(1);
    expect(queue.getSnapshot()).toEqual({ high: 0, normal: 0, low: 0 });
  });

  it('honors cooldown for normal events and lets high events jump ahead', async () => {
    const config = testConfig();
    const consumer = new MockLiveEventConsumer();
    const queue = new LiveEventQueue(config);
    const controller = new LiveController(queue, consumer, config);

    controller.onSpeechEnd(100000);
    queue.add({
      ...liveEvent({ id: 'normal-a', content: '白白你好', timestamp: 100100 }),
      priority: 60,
      expiresAt: 120000
    });
    await controller.tick(101000);
    expect(consumer.handledEvents).toHaveLength(0);

    queue.add({
      ...liveEvent({ id: 'high-a', content: '白白你喜欢主播吗？', timestamp: 101100 }),
      priority: 80,
      expiresAt: 120000
    });
    await controller.tick(101200);
    expect(consumer.handledEvents[0].id).toBe('high-a');
  });

  it('keeps events queued while AI is speaking', async () => {
    const config = testConfig();
    const consumer = new MockLiveEventConsumer();
    const queue = new LiveEventQueue(config);
    const controller = new LiveController(queue, consumer, config);
    queue.add({
      ...liveEvent({ id: 'high-speaking', content: '白白吗？', timestamp: 100000 }),
      priority: 80,
      expiresAt: 120000
    });

    controller.onSpeechStart();
    await controller.tick(100100);
    expect(consumer.handledEvents).toHaveLength(0);

    controller.onSpeechEnd(100200);
    await controller.tick(100201);
    expect(consumer.handledEvents[0].id).toBe('high-speaking');
  });
});

describe('LiveSystem integration', () => {
  it('does not send every raw danmaku to the consumer', async () => {
    const config = testConfig();
    const consumer = new MockLiveEventConsumer();
    const system = new LiveSystem(consumer, config);
    await system.initialize();
    const now = 100000;

    for (let index = 0; index < 80; index += 1) {
      system.ingestRaw(
        {
          platform: 'bilibili',
          type: 'DANMU_MSG',
          user: { id: `low${index}`, name: `Low${index}` },
          content: '666',
          timestamp: now + index
        },
        now + index
      );
    }
    for (let index = 0; index < 30; index += 1) {
      system.ingestRaw(
        {
          platform: 'bilibili',
          type: 'DANMU_MSG',
          user: { id: `behind${index}`, name: `Behind${index}` },
          content: '白白主播后面吗？',
          timestamp: now + 100 + index
        },
        now + 100 + index
      );
    }

    await system.tick(now + 1000);

    expect(consumer.handledEvents).toHaveLength(1);
    expect(consumer.handledEvents[0].content).toBe('白白主播后面吗？');
    expect(consumer.handledEvents[0].metadata?.aggregation?.uniqueUsers).toBe(30);
    expect(system.getDebugState(now + 1000).queue).toEqual({ high: 0, normal: 1, low: 0 });
    expect(system.queue.normal[0].metadata?.aggregation?.uniqueUsers).toBe(80);
  });
});

function liveEvent(overrides: Partial<LiveEvent> & { userId?: string } = {}): LiveEvent {
  const timestamp = overrides.timestamp ?? 100000;
  const userId = overrides.userId ?? overrides.user?.id ?? 'user';
  return {
    id: overrides.id ?? `${userId}-${timestamp}-${overrides.content ?? 'event'}`,
    platform: overrides.platform ?? 'bilibili',
    type: overrides.type ?? 'danmaku',
    user: overrides.user ?? { id: userId, name: userId },
    content: overrides.content ?? 'hello',
    timestamp,
    priority: overrides.priority ?? 20,
    expiresAt: overrides.expiresAt ?? timestamp + 8000,
    metadata: overrides.metadata ?? {}
  };
}

function testConfig(overrides: Partial<LiveConfig> = {}): LiveConfig {
  return {
    ...liveConfig,
    ...overrides,
    barrageGrab: { ...liveConfig.barrageGrab, ...overrides.barrageGrab },
    queue: { ...liveConfig.queue, ...overrides.queue },
    controller: { ...liveConfig.controller, ...overrides.controller },
    aggregation: { ...liveConfig.aggregation, ...overrides.aggregation },
    filter: { ...liveConfig.filter, ...overrides.filter },
    ttl: { ...liveConfig.ttl, ...overrides.ttl },
    petNames: overrides.petNames ?? liveConfig.petNames
  };
}
