import { liveConfig, type LiveConfig } from '../../integrations/barrage/config/live.config.ts';
import { MockLiveEventConsumer } from '../../integrations/barrage/controller/MockLiveEventConsumer';
import { LiveSystem } from '../../integrations/barrage/LiveSystem';

export interface LiveSystemDemoResult {
  system: LiveSystem;
  consumer: MockLiveEventConsumer;
  queued: ReturnType<LiveSystem['getDebugState']>;
  handledEvents: string[];
}

export async function runLiveSystemDemo(config: LiveConfig = liveConfig): Promise<LiveSystemDemoResult> {
  const consumer = new MockLiveEventConsumer();
  const system = new LiveSystem(consumer, config);
  await system.initialize();

  const now = Date.now();
  const messages = createDemoMessages(now);
  for (const message of messages) {
    system.ingestRaw(message, message.timestamp);
  }

  await system.tick(now + 1000);
  system.controller.onSpeechEnd(now + 1000);
  await system.tick(now + config.controller.responseCooldownMs + 1200);

  return {
    system,
    consumer,
    queued: system.getDebugState(now + 1000),
    handledEvents: consumer.handledEvents.map((event) => event.content ?? event.type)
  };
}

interface DemoRawDanmaku {
  platform: string;
  type: string;
  user: { id: string; name: string };
  content: string;
  timestamp: number;
}

export function createDemoMessages(now = Date.now()): DemoRawDanmaku[] {
  const messages: DemoRawDanmaku[] = [];
  for (let index = 0; index < 35; index += 1) {
    messages.push(
      createDanmaku(`low-666-${index}`, `Low${index}`, index % 2 === 0 ? '666' : '哈哈', now + index)
    );
  }
  messages.push(createDanmaku('c', 'C', '白白你好', now + 100));
  messages.push(createDanmaku('d', 'D', '主播今天玩什么？', now + 101));
  messages.push(createDanmaku('e', 'E', '白白你喜欢主播吗？', now + 102));
  for (let index = 0; index < 30; index += 1) {
    messages.push(createDanmaku(`behind-${index}`, `Behind${index}`, '主播后面！', now + 200 + index));
  }
  return messages;
}

function createDanmaku(userId: string, name: string, content: string, timestamp: number): DemoRawDanmaku {
  return {
    platform: 'bilibili',
    type: 'DANMU_MSG',
    user: { id: userId, name },
    content,
    timestamp
  };
}
