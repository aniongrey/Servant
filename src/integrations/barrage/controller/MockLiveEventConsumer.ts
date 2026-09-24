import type { LiveEvent, LiveEventConsumer } from '../events/LiveEvent';

export class MockLiveEventConsumer implements LiveEventConsumer {
  readonly handledEvents: LiveEvent[] = [];

  async handleLiveEvent(event: LiveEvent): Promise<void> {
    this.handledEvents.push(event);
    console.log(`[AI SHOULD RESPOND] ${event.user?.name ?? 'anonymous'}: ${event.content ?? event.type}`);
  }
}
