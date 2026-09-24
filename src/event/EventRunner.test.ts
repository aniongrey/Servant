import { describe, expect, it } from 'vitest';
import { ActionLoader } from '../character/motion/actions/ActionLoader';
import { ActionRuntime } from '../character/motion/actions/ActionRuntime';
import { AccessoryMotionController } from '../character/motion/AccessoryMotionController';
import { BodyMotionController } from '../character/motion/BodyMotionController';
import { ExpressionController } from '../character/expression/ExpressionController';
import { FxController } from '../character/motion/FxController';
import { GazeController } from '../character/expression/GazeController';
import { SpatialController } from '../character/motion/SpatialController';
import { SpeechController } from '../ai/tts/SpeechController';
import { MockVrmaLoader } from '../character/motion/MockVrmaLoader';
import { MotionAssetRegistry } from '../character/motion/MotionAssetRegistry';
import { RuntimeStore } from '../app/state/RuntimeStore';
import type { EventDefinition, MotionMeta, RuntimeContext } from '../app/runtimeTypes';
import { EventDirector } from './EventDirector';
import { EventRunner } from './EventRunner';

const testMotions: MotionMeta[] = [
  motion('idle_neutral', 'repeat', false),
  motion('mock_intro'),
  motion('mock_hold', 'repeat', false),
  motion('mock_react')
];

describe('Character Drama Runtime', () => {
  it('caches VRMA loads by motion id', async () => {
    const loader = new MockVrmaLoader(0);
    const registry = new MotionAssetRegistry(testMotions, loader);

    await Promise.all([registry.preload('mock_intro'), registry.preload('mock_intro')]);

    expect(loader.loadCount).toBe(1);
    expect(registry.loadedIds()).toEqual(['mock_intro']);
  });

  it('runs angry_tsundere_001 into the comfort branch after two comforts', async () => {
    const { director, store } = createTestHarness();
    const context: RuntimeContext = {
      emotions: store.getSnapshot().emotions,
      relationship: store.getSnapshot().relationship,
      personality: store.getSnapshot().personality,
      counters: { comfortCount: 2 }
    };

    await director.play('angry_tsundere_001', context, { force: true });

    const snapshot = store.getSnapshot();
    expect(snapshot.expression.id).toBe('blush');
    expect(snapshot.expression.gaze).toBe('peek');
    expect(snapshot.accessory.preset).toBe('tail_slow');
    expect(snapshot.speech.text).toBe('……别以为这样我就原谅你了。');
  });

  it('interrupts an active event through AbortSignal', async () => {
    const { director, store } = createTestHarness(40);
    const context: RuntimeContext = {
      emotions: store.getSnapshot().emotions,
      relationship: store.getSnapshot().relationship,
      personality: store.getSnapshot().personality,
      counters: { comfortCount: 0 }
    };

    const running = director.play('angry_tsundere_001', context, { force: true });
    director.interrupt();
    await running;

    expect(store.getSnapshot().director.currentEvent).toBeUndefined();
    expect(store.getSnapshot().body.phase).toBe('stopped');
  });

  it('does not wait for a step unless await true or wait is used', async () => {
    const nonBlockingEvent: EventDefinition = {
      id: 'non_blocking_event',
      title: 'non-blocking event',
      priority: 10,
      interruptPolicy: 'replace',
      cooldownMs: 0,
      steps: [
        { type: 'motion', id: 'mock_intro' },
        { type: 'expression', id: 'happy', weight: 1, gaze: 'user' }
      ]
    };
    const { director, store } = createTestHarness(80, [nonBlockingEvent]);
    const context = contextFromStore(store);

    const result = await Promise.race([
      director.play('non_blocking_event', context, { force: true }).then(() => 'done'),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 30))
    ]);

    expect(result).toBe('done');
    expect(store.getSnapshot().expression.id).toBe('happy');
  });

  it('honors cooldown unless a play is forced', async () => {
    const eventWithCooldown: EventDefinition = {
      ...testEvent,
      cooldownMs: 1000
    };
    const { director, store } = createTestHarness(0, [eventWithCooldown]);
    const context = contextFromStore(store);

    await director.play('angry_tsundere_001', context, { force: true });
    await director.play('angry_tsundere_001', context);

    const startedLogs = store
      .getSnapshot()
      .logs.filter((log) => log.message === 'Started angry_tsundere_001');
    expect(startedLogs).toHaveLength(1);
    expect(store.getSnapshot().logs.some((log) => log.message.includes('cooling down'))).toBe(true);
  });

  it('lets a higher priority event replace a lower priority event', async () => {
    const lowEvent = blockingEvent('low_event', 10);
    const highEvent = quickEvent('high_event', 20, 'replaceLowerPriority');
    const { director, store } = createTestHarness(0, [lowEvent, highEvent]);
    const context = contextFromStore(store);

    const lowRun = director.play('low_event', context, { force: true });
    await Promise.resolve();
    const highRun = director.play('high_event', context, { force: true });

    await Promise.all([lowRun, highRun]);

    expect(store.getSnapshot().logs.some((log) => log.message === 'Interrupted low_event')).toBe(true);
    expect(store.getSnapshot().speech.text).toBe('我才没有生气。');
  });

  it('keeps a lower priority replacement from interrupting a stronger event', async () => {
    const strongEvent = blockingEvent('strong_event', 30);
    const weakEvent = quickEvent('weak_event', 5, 'replaceLowerPriority');
    const { director, store } = createTestHarness(0, [strongEvent, weakEvent]);
    const context = contextFromStore(store);

    const strongRun = director.play('strong_event', context, { force: true });
    await Promise.resolve();
    await director.play('weak_event', context, { force: true });

    expect(
      store.getSnapshot().logs.some((log) => log.message === 'Ignored weak_event; strong_event is running')
    ).toBe(true);

    director.interrupt();
    await strongRun;
  });

  it('runs enqueued events FIFO without interrupting the active dialogue or sorting by priority', async () => {
    const activeEvent = blockingEvent('active_dialogue', 50);
    const firstReminder = quickEvent('first_reminder', 1, 'replace');
    const secondReminder = quickEvent('second_reminder', 999, 'replace');
    const { director, store } = createTestHarness(0, [activeEvent]);
    const context = contextFromStore(store);

    const activeRun = director.play('active_dialogue', context, { force: true });
    await Promise.resolve();
    const firstRun = director.enqueue(firstReminder, context);
    const secondRun = director.enqueue(secondReminder, context);

    expect(store.getSnapshot().director.currentEvent?.id).toBe('active_dialogue');
    expect(store.getSnapshot().logs.some((log) => log.message === 'Started first_reminder')).toBe(false);

    await Promise.all([activeRun, firstRun, secondRun]);

    const started = store
      .getSnapshot()
      .logs.filter((log) => log.message.startsWith('Started '))
      .map((log) => log.message)
      .reverse();
    expect(started).toEqual(['Started active_dialogue', 'Started first_reminder', 'Started second_reminder']);
    expect(store.getSnapshot().logs.some((log) => log.message === 'Interrupted active_dialogue')).toBe(false);
  });

  it('skips the active awaited step', async () => {
    const blocking = blockingEvent('blocking_event', 10);
    const { director, store } = createTestHarness(0, [blocking]);
    const context = contextFromStore(store);

    const running = director.play('blocking_event', context, { force: true });
    await Promise.resolve();
    director.skipStep();
    await running;

    expect(store.getSnapshot().logs.some((log) => log.message === 'Skipped step 1')).toBe(true);
  });
});

function createTestHarness(loaderLatencyMs = 0, events: EventDefinition[] = [testEvent]) {
  const store = new RuntimeStore();
  const actionLoader = new ActionLoader();
  const registry = new MotionAssetRegistry(
    [...testMotions, ...actionLoader.createMotionMetas()],
    new MockVrmaLoader(loaderLatencyMs)
  );
  const body = new BodyMotionController(registry, store);
  const controllers = {
    action: new ActionRuntime(actionLoader, body, store),
    body,
    spatial: new SpatialController(store),
    expression: new ExpressionController(store),
    gaze: new GazeController(store),
    accessory: new AccessoryMotionController(store),
    fx: new FxController(store),
    speech: new SpeechController(
      {
        deny_being_angry: ['我才没有生气。'],
        need_more_comfort: ['再认真一点。'],
        pretend_not_forgiven: ['……别以为这样我就原谅你了。']
      },
      store,
      0
    )
  };
  const runner = new EventRunner(controllers, store);
  const director = new EventDirector(events, runner, controllers, store);
  return { director, store };
}

function contextFromStore(store: RuntimeStore): RuntimeContext {
  return {
    emotions: store.getSnapshot().emotions,
    relationship: store.getSnapshot().relationship,
    personality: store.getSnapshot().personality,
    counters: store.getSnapshot().counters
  };
}

function motion(id: string, loop: MotionMeta['loop'] = 'once', returnToIdle = false): MotionMeta {
  return {
    id,
    url: `/mock/${id}.vrma`,
    loop,
    defaultFadeIn: 0,
    defaultFadeOut: 0,
    interruptible: true,
    returnToIdle,
    tags: [],
    durationMs: 1
  };
}

const testEvent: EventDefinition = {
  id: 'angry_tsundere_001',
  title: 'test event',
  priority: 70,
  interruptPolicy: 'replace',
  cooldownMs: 0,
  steps: [
    { type: 'motion', id: 'mock_intro', await: true },
    { type: 'expression', id: 'angry', weight: 0.86, gaze: 'avoid' },
    { type: 'accessory', preset: 'tail_angry' },
    { type: 'motion', id: 'mock_hold', await: false, loop: 'repeat' },
    { type: 'speech', intent: 'deny_being_angry', await: true },
    {
      type: 'branch',
      condition: 'comfortCount >= 2',
      then: [
        { type: 'motion', id: 'mock_react', await: true },
        { type: 'expression', id: 'blush', weight: 0.78, gaze: 'peek' },
        { type: 'accessory', preset: 'tail_slow' },
        { type: 'speech', intent: 'pretend_not_forgiven', await: true }
      ],
      else: [{ type: 'speech', intent: 'need_more_comfort', await: true }]
    }
  ]
};

function blockingEvent(id: string, priority: number): EventDefinition {
  return {
    id,
    title: id,
    priority,
    interruptPolicy: 'replace',
    cooldownMs: 0,
    steps: [{ type: 'wait', ms: 50 }]
  };
}

function quickEvent(
  id: string,
  priority: number,
  interruptPolicy: EventDefinition['interruptPolicy']
): EventDefinition {
  return {
    id,
    title: id,
    priority,
    interruptPolicy,
    cooldownMs: 0,
    steps: [{ type: 'speech', intent: 'deny_being_angry', await: true }]
  };
}
