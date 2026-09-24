import type { DesktopRealtimeSyncEvent } from '../../app/network/realtime/DesktopRealtimeSync';
import type { VoiceStreamEvent } from '../../app/network/realtime/VoiceStreamProtocol';

export type ReminderSyncEvent = Extract<DesktopRealtimeSyncEvent, { type: 'reminder' }>;

export class DesktopReminderQueue {
  private readonly pending: ReminderSyncEvent[] = [];
  private readonly seenIds = new Set<string>();
  private readonly seenIdOrder: string[] = [];
  private readonly activeSpeechIds = new Set<string>();
  private processor?: (event: ReminderSyncEvent) => Promise<void>;
  private running = false;
  private disposed = false;

  constructor(
    private readonly onStatus: (type: 'reminder-started' | 'reminder-completed', jobId: string) => void
  ) {}

  setProcessor(processor?: (event: ReminderSyncEvent) => Promise<void>): void {
    this.processor = processor;
    void this.drain();
  }

  /** `desktop.sync` events: reminders to enqueue (speech state arrives on action.voice). */
  handle(event: DesktopRealtimeSyncEvent): void {
    if (this.disposed) return;
    if (event.type !== 'reminder' || this.seenIds.has(event.jobId) || !hasReminderContent(event)) return;
    this.remember(event.jobId);
    this.pending.push(event);
    void this.drain();
  }

  /** `action.voice` events: speech state keeps reminders from interrupting playback. */
  handleVoiceEvent(event: VoiceStreamEvent): void {
    if (this.disposed) return;
    if (event.type === 'speech-start') {
      this.activeSpeechIds.add(event.id);
      return;
    }
    if (event.type === 'speech-end' || event.type === 'speech-cancel') {
      this.activeSpeechIds.delete(event.id);
      void this.drain();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.pending.length = 0;
    this.seenIds.clear();
    this.seenIdOrder.length = 0;
    this.activeSpeechIds.clear();
    this.processor = undefined;
  }

  private async drain(): Promise<void> {
    if (
      this.disposed ||
      this.running ||
      !this.processor ||
      this.activeSpeechIds.size > 0 ||
      this.pending.length === 0
    ) {
      return;
    }
    const event = this.pending.shift()!;
    this.running = true;
    this.onStatus('reminder-started', event.jobId);
    try {
      await this.processor(event);
    } finally {
      this.running = false;
      if (!this.disposed) {
        this.onStatus('reminder-completed', event.jobId);
        void this.drain();
      }
    }
  }

  private remember(jobId: string): void {
    this.seenIds.add(jobId);
    this.seenIdOrder.push(jobId);
    if (this.seenIdOrder.length <= 500) return;
    const expiredId = this.seenIdOrder.shift();
    if (expiredId) this.seenIds.delete(expiredId);
  }
}

function hasReminderContent(event: ReminderSyncEvent): boolean {
  return Boolean(
    event.message.trim() || event.speech?.trim() || event.action?.trim() || event.emotion?.trim()
  );
}
