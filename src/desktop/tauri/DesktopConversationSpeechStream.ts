import type { SpeechController } from '../../ai/tts/SpeechController';
import type { TtsTurn } from '../../ai/tts/types';
import type { DesktopReplySegment, VoiceStreamEvent } from '../../app/network/realtime/VoiceStreamProtocol';
import type { ReplyShortActionRuntime } from '../../character/motion/reply/ReplyShortActionRuntime';
import type { PersonalityMood } from '../../ai/llm/types';

/**
 * Replays the chat window's cumulative speech stream on the desktop character.
 * Reminder speech deliberately uses its own action queue and is ignored here.
 */
export class DesktopConversationSpeechStream {
  private activeId?: string;
  private latestText = '';
  private turn?: TtsTurn;
  private playback: 'stream' | 'final' = 'stream';
  private sequenceController?: AbortController;
  private readonly pendingSegments = new Map<number, DesktopReplySegment>();
  private nextSequenceIndex = 0;
  private expectedSegmentCount?: number;
  private sequencePumping = false;
  private playbackStarted = false;

  constructor(
    private readonly speech: Pick<SpeechController, 'startStreaming' | 'cancel'> &
      Partial<Pick<SpeechController, 'prefetchSpeech'>>,
    private readonly onPlaybackStatus: (
      type: 'speech-playback-started' | 'speech-playback-completed',
      id: string
    ) => void = () => undefined,
    private readonly replyActions?: Pick<ReplyShortActionRuntime, 'play' | 'returnToIdle'> &
      Partial<Pick<ReplyShortActionRuntime, 'startSpeaking'>>,
    private readonly applyPresentation: (emotion: PersonalityMood, intensity: number) => void = () =>
      undefined
  ) {}

  handle(event: VoiceStreamEvent): void {
    if (!('source' in event) || event.source !== 'conversation') return;
    if (event.type === 'reply-sequence') {
      this.startReplyStream(event.id, event.segments[0]);
      event.segments
        .slice(1)
        .forEach((segment, index) => this.enqueueReplySegment(event.id, index + 1, segment));
      this.finishReplyStream(event.id, event.segments.length);
      return;
    }
    if (event.type === 'reply-stream-start') {
      this.startReplyStream(event.id, event.segment);
      return;
    }
    if (event.type === 'reply-stream-segment') {
      this.enqueueReplySegment(event.id, event.index, event.segment);
      return;
    }
    if (event.type === 'reply-stream-end') {
      this.finishReplyStream(event.id, event.segmentCount);
      return;
    }
    if (event.type === 'speech-start') {
      this.cancel();
      this.activeId = event.id;
      this.latestText = event.text;
      this.playback = event.playback ?? 'stream';
      this.turn = this.speech.startStreaming({
        intent: 'conversation_reply',
        onPlaybackStart: () => this.reportPlaybackStarted(event.id)
      });
      this.replyActions?.startSpeaking?.();
      if (this.playback === 'stream') this.turn.push(event.text);
      return;
    }
    if (event.type === 'speech-delta' && event.id === this.activeId) {
      this.latestText = event.text;
      if (this.playback === 'stream') this.turn?.push(event.text);
      return;
    }
    if (event.type === 'speech-end' && event.id === this.activeId) {
      const finalText = event.text ?? this.latestText;
      const turn = this.turn;
      const activeId = this.activeId;
      void turn?.finish(finalText, event.spokenText ?? finalText).finally(() => {
        if (this.activeId !== activeId) return;
        this.activeId = undefined;
        this.latestText = '';
        this.turn = undefined;
        this.replyActions?.returnToIdle();
        this.onPlaybackStatus('speech-playback-completed', activeId);
      });
      return;
    }
    if (event.type === 'speech-cancel' && event.id === this.activeId) {
      this.cancel();
    }
  }

  dispose(): void {
    this.cancel();
  }

  private cancel(): void {
    const activeId = this.activeId;
    const wasSequence = Boolean(this.sequenceController);
    this.sequenceController?.abort();
    this.sequenceController = undefined;
    this.pendingSegments.clear();
    this.nextSequenceIndex = 0;
    this.expectedSegmentCount = undefined;
    this.sequencePumping = false;
    this.playbackStarted = false;
    this.turn?.cancel();
    this.turn = undefined;
    this.activeId = undefined;
    this.latestText = '';
    this.playback = 'stream';
    this.speech.cancel();
    if (wasSequence || activeId) this.replyActions?.returnToIdle();
    if (activeId) this.onPlaybackStatus('speech-playback-completed', activeId);
  }

  private startReplyStream(id: string, firstSegment: DesktopReplySegment): void {
    this.cancel();
    this.activeId = id;
    this.sequenceController = new AbortController();
    this.pendingSegments.set(0, firstSegment);
    this.pumpReplyStream();
  }

  private enqueueReplySegment(id: string, index: number, segment: DesktopReplySegment): void {
    if (this.activeId !== id || !this.sequenceController || index < this.nextSequenceIndex) return;
    this.pendingSegments.set(index, segment);
    this.pumpReplyStream();
  }

  private finishReplyStream(id: string, segmentCount: number): void {
    if (this.activeId !== id || !this.sequenceController) return;
    this.expectedSegmentCount = segmentCount;
    this.pumpReplyStream();
    this.completeReplyStreamIfReady(id);
  }

  private pumpReplyStream(): void {
    if (this.sequencePumping || !this.sequenceController || !this.activeId) return;
    this.sequencePumping = true;
    const id = this.activeId;
    void this.runReplyStream(id, this.sequenceController.signal);
  }

  private async runReplyStream(id: string, signal: AbortSignal): Promise<void> {
    try {
      while (this.activeId === id) {
        const segment = this.pendingSegments.get(this.nextSequenceIndex);
        if (!segment) break;
        this.pendingSegments.delete(this.nextSequenceIndex);
        this.nextSequenceIndex += 1;
        signal.throwIfAborted();
        this.applyPresentation(segment.emotion, segment.intensity);
        void this.replyActions?.play(segment.shortAction, signal).catch(() => undefined);
        const turn = this.speech.startStreaming({
          intent: 'conversation_reply',
          signal,
          onPlaybackStart: () => {
            this.reportPlaybackStarted(id);
            // Render the next segment while this one is still speaking: the
            // sequence stays serial, only its synthesis overlaps.
            this.prefetchNextSegment();
          }
        });
        this.turn = turn;
        await turn.finish(segment.text, segment.spokenText);
      }
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) throw cause;
    } finally {
      if (this.activeId !== id) return;
      this.sequencePumping = false;
      if (this.pendingSegments.has(this.nextSequenceIndex)) this.pumpReplyStream();
      this.completeReplyStreamIfReady(id);
    }
  }

  private completeReplyStreamIfReady(id: string): void {
    if (
      this.activeId !== id ||
      this.expectedSegmentCount === undefined ||
      this.nextSequenceIndex < this.expectedSegmentCount ||
      this.sequencePumping
    )
      return;
    this.replyActions?.returnToIdle();
    this.sequenceController = undefined;
    this.pendingSegments.clear();
    this.expectedSegmentCount = undefined;
    this.turn = undefined;
    this.activeId = undefined;
    this.latestText = '';
    this.onPlaybackStatus('speech-playback-completed', id);
  }

  private reportPlaybackStarted(id: string): void {
    if (this.activeId !== id || this.playbackStarted) return;
    this.playbackStarted = true;
    this.onPlaybackStatus('speech-playback-started', id);
  }

  /**
   * Asks for the next segment's audio before it is due. `nextSequenceIndex`
   * already points past the segment being spoken, so this is the same segment
   * `runReplyStream` will pick up as soon as the current one ends — which is
   * what turns "synthesize, then speak" into "speak, with the audio already in
   * hand" for every segment after the first.
   */
  private prefetchNextSegment(): void {
    const next = this.pendingSegments.get(this.nextSequenceIndex);
    if (next) this.speech.prefetchSpeech?.(next.spokenText);
  }
}
