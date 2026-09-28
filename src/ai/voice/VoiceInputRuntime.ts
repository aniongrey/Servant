import type { SpeechRecognizer, SpeechPipelineTimings } from '../stt/speechRecognitionTypes';
import type { VoiceSettings } from './VoiceSettings';
import {
  emptyVoiceState,
  sameVoiceTarget,
  selectVoiceEndpoint,
  type VoiceEndpoint,
  type VoiceEvent,
  type VoiceInputState,
  type VoiceResult
} from './VoiceInputProtocol';

/** Owns capture only. Conversation cancellation and submission stay in the receiving page. */
export class VoiceInputRuntime {
  readonly endpoints = new Map<string, VoiceEndpoint>();
  state: VoiceInputState = { ...emptyVoiceState, pending: [] };
  private armed = false;
  private pressed = false;
  private running = false;
  private manual = false;
  private capture: { endpoint: VoiceEndpoint; autoSend: boolean } | null = null;
  private generation = 0;
  private deadline = 0;
  private decodeDeadline = 0;
  private timings: SpeechPipelineTimings | undefined;
  private playing = new Map<string, number>();

  constructor(
    private recognizer: SpeechRecognizer,
    private settings: VoiceSettings,
    private emit: (event: VoiceEvent) => void,
    private now = () => Date.now()
  ) {}

  async preload() {
    try {
      await this.recognizer.preload();
      this.state.ready = true;
    } catch (error) {
      this.state.error = String(error);
    }
    this.publish();
  }

  configure(settings: VoiceSettings) {
    const restart =
      settings.inputMode !== this.settings.inputMode ||
      settings.inputDeviceId !== this.settings.inputDeviceId;
    this.settings = settings;
    if (restart) {
      this.abort();
      this.armed = settings.inputMode !== 'muted';
    }
    this.tick();
  }

  register(endpoint: VoiceEndpoint) {
    this.endpoints.set(endpoint.id, { ...endpoint, updatedAt: this.now() });
    this.tick();
  }

  leave(id: string) {
    this.endpoints.delete(id);
    this.tick();
  }

  async activate() {
    this.armed = this.settings.inputMode !== 'muted';
    this.state.error = '';
    if (!this.state.ready) await this.preload();
    this.tick();
  }

  press() {
    if (this.pressed || this.settings.inputMode === 'muted') return;
    if (!this.armed) {
      this.state.error = '语音已暂停，请切换语音模式恢复。';
      this.publish();
      return;
    }
    const endpoint = this.target();
    if (!endpoint) {
      this.state.error = '没有有效的语音接收目标，请先打开对话。';
      this.publish();
      return;
    }
    if (!this.state.ready) {
      this.state.error = '语音模型正在加载，请稍候。';
      this.publish();
      return;
    }
    if (this.state.phase === 'transcribing') return;
    this.abort();
    this.pressed = true;
    this.armed = true;
    this.start(true, endpoint);
  }

  release() {
    if (!this.pressed) return;
    this.pressed = false;
    this.finish();
  }

  stop() {
    this.armed = false;
    this.abort();
    this.emit({ type: 'stopped' });
    this.publish();
  }

  private abort() {
    this.generation++;
    this.recognizer.abort();
    this.running = false;
    this.pressed = false;
    this.capture = null;
    this.deadline = 0;
    this.decodeDeadline = 0;
    this.state.phase = 'idle';
  }

  private target() {
    return selectVoiceEndpoint(this.endpoints.values(), this.settings.backgroundEnabled, this.now());
  }

  private lock(endpoint: VoiceEndpoint) {
    this.capture = { endpoint: { ...endpoint }, autoSend: this.settings.autoSend };
    this.timings = undefined;
    this.state.targetLabel = endpoint.target!.label;
    this.deadline = this.now() + 60_000;
    if (this.settings.interruptOnSpeech)
      this.emit({ type: 'interrupt', id: endpoint.id, target: endpoint.target! });
  }

  private start(manual: boolean, endpoint: VoiceEndpoint) {
    const generation = ++this.generation;
    this.running = true;
    this.manual = manual;
    this.state.error = '';
    this.state.phase = 'initializing';
    if (manual) this.lock(endpoint);
    this.recognizer.startContinuous({
      mode: manual ? 'manual' : 'realtime',
      onStarted: () => {
        if (generation !== this.generation) return;
        this.state.phase = manual ? 'recording' : 'listening';
        this.publish();
      },
      onSpeechStart: () => {
        if (generation !== this.generation) return;
        if (!manual) {
          const target = this.target();
          if (!target) {
            this.abort();
            this.publish();
            return;
          }
          this.lock(target);
        }
        this.state.phase = 'recording';
        this.publish();
      },
      onSpeechEnd: () => {
        if (generation !== this.generation) return;
        this.deadline = 0;
        this.decodeDeadline = this.now() + 60_000;
        this.state.phase = 'transcribing';
        this.publish();
      },
      onTranscript: (text, final) => {
        if (generation !== this.generation || !final || !this.capture || !text.trim()) return;
        const { endpoint: locked, autoSend } = this.capture;
        const result: VoiceResult = {
          id: crypto.randomUUID(),
          endpointId: locked.id,
          target: locked.target!,
          text,
          autoSend: autoSend && this.settings.autoSend,
          timings: this.timings
        };
        this.state.pending.push(result);
        this.publish(); // Persist before delivery; unacknowledged text is always recoverable.
        const live = this.endpoints.get(locked.id);
        if (live && this.now() - live.updatedAt < 6000 && sameVoiceTarget(live.target, locked.target)) {
          this.emit({ type: 'result', result });
        } else this.state.error = '原接收目标不可用，识别文字已保留在待处理语音中。';
      },
      onEnd: () => {
        if (generation !== this.generation) return;
        this.capture = null;
        this.deadline = 0;
        this.decodeDeadline = 0;
        if (this.manual || !this.running) this.abort();
        else this.state.phase = 'listening';
        this.publish();
      },
      onTimings: (timings) => {
        if (generation === this.generation) this.timings = timings;
      },
      onError: (error) => {
        if (generation !== this.generation) return;
        this.armed = false;
        this.abort();
        this.state.error = error.message;
        this.publish();
      }
    });
    this.publish();
  }

  private finish() {
    if (this.state.phase === 'transcribing') return;
    if (this.recognizer.finishCurrentUtterance()) {
      this.state.phase = 'transcribing';
      // A flushed realtime session has stopped its microphone too.
      this.manual = true;
      this.deadline = 0;
      this.decodeDeadline = this.now() + 60_000;
    } else this.abort();
    this.publish();
  }

  playback(id: string, speaking: boolean) {
    if (speaking) this.playing.set(id, this.now() + 120_000);
    else this.playing.delete(id);
    this.tick();
  }

  playbackDisconnected() {
    this.playing.clear();
    this.tick();
  }

  tick() {
    const now = this.now();
    if (this.decodeDeadline && now >= this.decodeDeadline) {
      this.stop();
      this.state.error = '语音识别超时，请重试。';
    }
    for (const [id, until] of this.playing) if (until <= now) this.playing.delete(id);
    if (this.deadline && now >= this.deadline) {
      if (this.capture) this.capture.autoSend = false;
      this.pressed = false;
      this.finish();
      this.state.error = '录音已达 60 秒，已结束并保留草稿。';
    }
    if (
      this.capture &&
      !this.settings.backgroundEnabled &&
      !this.target() &&
      this.state.phase !== 'transcribing'
    ) {
      this.capture.autoSend = false;
      this.pressed = false;
      this.finish();
    }
    const blocked = this.settings.muteWhileSpeaking && this.playing.size > 0;
    const wantsRealtime =
      this.armed && this.state.ready && this.settings.inputMode === 'realtime' && !!this.target() && !blocked;
    if (this.running && !this.manual && this.state.phase === 'transcribing' && !wantsRealtime) {
      this.recognizer.pauseCapture();
      this.manual = true;
      if (this.capture && !this.settings.backgroundEnabled && !this.target()) this.capture.autoSend = false;
    }
    if (!this.pressed && this.state.phase !== 'transcribing') {
      if (this.running && !this.manual && !wantsRealtime) this.abort();
      if (!this.running && wantsRealtime) this.start(false, this.target()!);
      if (!this.running && this.armed && this.settings.inputMode === 'realtime') this.state.phase = 'paused';
    }
    if (!this.capture) this.state.targetLabel = this.target()?.target?.label ?? '';
    this.publish();
  }

  ack(endpointId: string, resultId: string) {
    this.state.pending = this.state.pending.filter(
      (item) => item.id !== resultId || item.endpointId !== endpointId
    );
    this.publish();
  }

  recover(endpointId: string, resultId: string) {
    const endpoint = this.endpoints.get(endpointId);
    const result = this.state.pending.find((item) => item.id === resultId);
    if (!endpoint?.target || !result) return;
    result.endpointId = endpointId;
    result.target = endpoint.target;
    result.autoSend = false;
    this.emit({ type: 'result', result });
  }

  private publish() {
    this.state.enabled = this.armed;
    this.emit({ type: 'state', state: { ...this.state, pending: [...this.state.pending] } });
  }
  destroy() {
    this.stop();
    this.recognizer.destroy();
  }
}
