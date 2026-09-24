import {
  AUDIO_WORKLET_URL,
  RUNTIME_BASE_PATH,
  TARGET_SAMPLE_RATE,
  VAD_FRAME_SIZE,
  WORKER_INITIALIZATION_TIMEOUT_MS,
  createSenseVoiceAssetUrls,
  createSenseVoiceConfig,
  createSileroVadConfig
} from './sherpaSpeechConfig';
import { ensureApiBase } from '../../app/network/apiBase.ts';
import { concatAudioChunks, normalizeTranscript, peakAmplitude } from './speechAudioUtils';
import { loadVoiceSettings } from '../voice/VoiceSettings';
import type {
  SpeechPipelineTimings,
  SpeechRecognitionCallbacks,
  SpeechSessionMode
} from './speechRecognitionTypes';

interface SenseVoiceResult {
  text?: string;
}

interface WorkerReadyMessage {
  type: 'ready';
}

interface WorkerInitErrorMessage {
  type: 'init-error';
  message: string;
}

interface WorkerDecodeResultMessage {
  type: 'decode-result';
  id: number;
  result: SenseVoiceResult;
  elapsedMs: number;
}

interface WorkerDecodeErrorMessage {
  type: 'decode-error';
  id: number;
  message: string;
}

interface WorkerVadEventMessage {
  type: 'vad-event';
  event: 'reset' | 'speech-start' | 'speech-end' | 'vad-misfire';
  audioBuffer?: ArrayBuffer;
  samples?: number;
  start?: number;
}

interface WorkerVadErrorMessage {
  type: 'vad-error';
  message: string;
}

type WorkerMessage =
  | WorkerReadyMessage
  | WorkerInitErrorMessage
  | WorkerDecodeResultMessage
  | WorkerDecodeErrorMessage
  | WorkerVadEventMessage
  | WorkerVadErrorMessage;

interface PendingDecode {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
}

type AudioContextConstructor = typeof AudioContext;

/** Local microphone capture + whole-utterance SenseVoice recognition. */
export class SherpaSpeechRecognition {
  private worker: Worker | null = null;
  private initialization: Promise<void> | null = null;
  private initialized = false;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private audioNode: AudioWorkletNode | null = null;
  private silenceGain: GainNode | null = null;
  private inputWatchdog: number | null = null;
  private readonly utteranceChunks: Float32Array[] = [];
  private readonly pendingDecodes = new Map<number, PendingDecode>();
  private callbacks: SpeechRecognitionCallbacks | null = null;
  private sessionMode: SpeechSessionMode = 'manual';
  private activeSessionId: number | null = null;
  private sessionId = 0;
  private decodeId = 0;
  private utteranceActive = false;
  private finalizing = false;
  private speechStartedAt: number | null = null;
  private recordingMs = 0;
  private lastInputSampleRate = TARGET_SAMPLE_RATE;
  private capturedFrameCount = 0;
  private capturedSampleCount = 0;
  private capturedPeak = 0;

  isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof Worker !== 'undefined' &&
      typeof AudioWorkletNode !== 'undefined' &&
      typeof WebAssembly !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      Boolean(getAudioContextConstructor())
    );
  }

  isReady(): boolean {
    return this.initialized;
  }

  /** Loads the local SenseVoice worker and model without requesting microphone access. */
  preload(): Promise<void> {
    if (!this.isSupported()) return Promise.reject(new Error('当前环境不支持本地语音识别。'));
    if (
      typeof SharedArrayBuffer === 'undefined' ||
      typeof crossOriginIsolated === 'undefined' ||
      !crossOriginIsolated
    ) {
      return Promise.reject(
        new Error('本地 SenseVoice 需要跨源隔离。请为页面配置 COOP=same-origin 和 COEP=require-corp。')
      );
    }
    return this.ensureInitialized();
  }

  async listen(
    onFinal?: (text: string) => void,
    onStarted?: () => void,
    onTimings?: (timings: SpeechPipelineTimings) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      this.startContinuous({
        mode: 'manual',
        onTranscript: (text, isFinal) => {
          if (!isFinal) return;
          onFinal?.(text);
          this.abort();
          resolve(text);
        },
        onError: reject,
        onEnd: () => resolve(''),
        onStarted,
        onTimings
      });
    });
  }

  startContinuous(
    callbacksOrTranscript: SpeechRecognitionCallbacks | ((text: string, isFinal: boolean) => void),
    onError?: (error: Error) => void,
    onEnd?: () => void,
    onStarted?: () => void,
    onTimings?: (timings: SpeechPipelineTimings) => void,
    _pushToTalk = false,
    onSpeechStart?: () => void
  ): void {
    const callbacks =
      typeof callbacksOrTranscript === 'function'
        ? {
            mode: 'manual' as const,
            onTranscript: callbacksOrTranscript,
            onError: onError ?? (() => undefined),
            onEnd,
            onStarted,
            onTimings,
            onSpeechStart
          }
        : callbacksOrTranscript;

    const sessionId = ++this.sessionId;
    this.activeSessionId = sessionId;
    this.callbacks = callbacks;
    this.sessionMode = callbacks.mode ?? 'manual';
    this.resetSentenceAssembly();
    void this.startSession(sessionId);
  }

  finishCurrentUtterance(): boolean {
    if (this.activeSessionId === null) return false;
    if (this.sessionMode === 'realtime') {
      if (!this.utteranceActive) return false;
      this.worker?.postMessage({ type: 'vad-flush' });
      this.stopMicrophone();
      return true;
    }
    if (!this.utteranceActive) return false;
    this.finishRecording();
    return true;
  }

  abort(): void {
    this.sessionId += 1;
    this.activeSessionId = null;
    this.callbacks = null;
    this.stopMicrophone();
    this.worker?.postMessage({ type: 'vad-reset' });
    this.resetSentenceAssembly();
  }

  destroy(): void {
    this.abort();
    for (const pending of this.pendingDecodes.values()) {
      pending.reject(new Error('Speech recognizer was destroyed.'));
    }
    this.pendingDecodes.clear();
    this.worker?.postMessage({ type: 'dispose' });
    this.worker?.terminate();
    this.worker = null;
    this.initialization = null;
    this.initialized = false;
  }

  private async startSession(sessionId: number): Promise<void> {
    try {
      this.log('starting session', { sessionId, mode: this.sessionMode });
      await this.preload();
      this.log('model ready', { sessionId });
      await this.startMicrophone();
      if (sessionId !== this.sessionId) return;
      if (this.sessionMode === 'manual') this.startRecording();
      else this.worker?.postMessage({ type: 'vad-reset' });
      this.callbacks?.onStarted?.();
    } catch (cause) {
      if (sessionId !== this.sessionId) return;
      this.callbacks?.onError(toError(cause));
    }
  }

  private ensureInitialized(): Promise<void> {
    if (this.initialization) return this.initialization;

    this.log('creating worker');
    this.worker = new Worker(`${RUNTIME_BASE_PATH}/offline-worker.js`);
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.handleWorkerMessage(event.data);
    let failInitialization: ((error: Error) => void) | null = null;
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'SenseVoice worker failed.');
      this.log('worker runtime error', {
        message: error.message,
        filename: event.filename,
        line: event.lineno
      });
      failInitialization?.(error);
      this.callbacks?.onError(error);
    };

    const initialization: Promise<void> = ensureApiBase()
      // The model lives in a directory only the backend can serve, so the asset
      // URLs must be absolute before the worker asks for them. A failed
      // handshake leaves the base empty and the worker reports a missing model,
      // which is the honest outcome.
      .catch(() => undefined)
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(() => {
              reject(
                new Error(
                  'SenseVoice 初始化超时：官方 WASM 数据包未能在两分钟内加载完成。请检查网络、硬盘缓存和跨源隔离配置。'
                )
              );
            }, WORKER_INITIALIZATION_TIMEOUT_MS);
            const settle = (callback: () => void) => {
              window.clearTimeout(timeout);
              failInitialization = null;
              callback();
            };
            failInitialization = (error) => settle(() => reject(error));
            const ready = (event: MessageEvent<WorkerMessage>) => {
              const message = event.data;
              if (message.type === 'ready') {
                this.worker?.removeEventListener('message', ready);
                this.log('worker ready');
                this.initialized = true;
                settle(resolve);
              } else if (message.type === 'init-error') {
                this.worker?.removeEventListener('message', ready);
                this.log('worker initialization failed', { message: message.message });
                settle(() => reject(new Error(message.message)));
              }
            };
            this.worker?.addEventListener('message', ready);
            this.worker?.postMessage({
              type: 'init',
              sampleRate: TARGET_SAMPLE_RATE,
              config: createSenseVoiceConfig(),
              vadConfig: createSileroVadConfig(),
              assets: createSenseVoiceAssetUrls()
            });
          })
      )
      .catch((error) => {
        this.worker?.terminate();
        this.worker = null;
        this.initialization = null;
        this.initialized = false;
        throw error;
      });

    this.initialization = initialization;
    return this.initialization;
  }

  private async startMicrophone(): Promise<void> {
    if (this.audioNode) return;
    const AudioContextCtor = getAudioContextConstructor();
    if (!AudioContextCtor) throw new Error('当前浏览器不支持 Web Audio。');

    const { inputDeviceId } = loadVoiceSettings();
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(inputDeviceId ? { deviceId: { exact: inputDeviceId } } : {}),
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    this.audioContext = new AudioContextCtor();
    this.lastInputSampleRate = this.audioContext.sampleRate;
    await this.audioContext.audioWorklet.addModule(AUDIO_WORKLET_URL);
    this.log('microphone opened', {
      sampleRate: this.lastInputSampleRate,
      settings: this.mediaStream.getAudioTracks()[0]?.getSettings()
    });
    this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.audioNode = new AudioWorkletNode(this.audioContext, 'sensevoice-audio-input', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: {
        targetSampleRate: TARGET_SAMPLE_RATE,
        inputSampleRate: this.audioContext.sampleRate,
        frameSize: VAD_FRAME_SIZE
      }
    });
    this.silenceGain = this.audioContext.createGain();
    this.silenceGain.gain.value = 0;
    this.audioNode.port.onmessage = (event: MessageEvent<{ type?: string; audioBuffer?: ArrayBuffer }>) => {
      this.clearInputWatchdog();
      if (event.data.type !== 'frame' || !event.data.audioBuffer) return;
      this.processInputFrame(new Float32Array(event.data.audioBuffer));
    };
    this.source.connect(this.audioNode);
    this.audioNode.connect(this.silenceGain);
    this.silenceGain.connect(this.audioContext.destination);
    await this.audioContext.resume();
    if (this.audioContext.state !== 'running')
      throw new Error('麦克风音频上下文未启动。请重新开启实时麦克风。');
    this.log('audio graph running', { sampleRate: this.audioContext.sampleRate });
    this.inputWatchdog = window.setTimeout(() => {
      if (this.audioNode)
        this.callbacks?.onError(new Error('未收到麦克风音频。请检查浏览器的麦克风权限和输入设备。'));
    }, 2_000);
  }

  private stopMicrophone(): void {
    this.clearInputWatchdog();
    this.audioNode?.port.close();
    this.audioNode?.disconnect();
    this.silenceGain?.disconnect();
    this.source?.disconnect();
    this.audioNode = null;
    this.silenceGain = null;
    this.source = null;
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
    void this.audioContext?.close();
    this.audioContext = null;
  }

  private processInputFrame(samples: Float32Array): void {
    if (this.activeSessionId === null || this.finalizing) return;
    if (this.sessionMode === 'realtime') {
      this.worker?.postMessage({ type: 'vad-frame', audioBuffer: samples.buffer }, [samples.buffer]);
      return;
    }
    if (!this.utteranceActive) return;
    this.utteranceChunks.push(samples);
    this.capturedFrameCount += 1;
    this.capturedSampleCount += samples.length;
    this.capturedPeak = Math.max(this.capturedPeak, peakAmplitude(samples));
    if (this.capturedFrameCount === 1) {
      this.log('first microphone frame', {
        inputSampleRate: this.lastInputSampleRate,
        samples: samples.length
      });
    }
  }

  private startRecording(): void {
    if (this.utteranceActive) return;
    this.utteranceActive = true;
    this.speechStartedAt = nowMs();
    this.log('recording started', { sessionId: this.activeSessionId, mode: this.sessionMode });
    this.callbacks?.onSpeechStart?.();
  }

  private finishRecording(): void {
    if (this.finalizing) return;
    this.finalizing = true;
    const completedAt = nowMs();
    this.recordingMs = Math.max(0, completedAt - (this.speechStartedAt ?? completedAt));
    const audio = concatAudioChunks(this.utteranceChunks);
    const sessionId = this.activeSessionId;
    const captureStats = {
      frames: this.capturedFrameCount,
      samples: this.capturedSampleCount,
      peak: Number(this.capturedPeak.toFixed(5))
    };
    this.resetActiveUtterance();
    this.stopMicrophone();
    this.log('recording stopped', {
      sessionId,
      recordingMs: Math.round(this.recordingMs),
      ...captureStats,
      audioMs: Math.round((audio.length / TARGET_SAMPLE_RATE) * 1000)
    });

    void this.decodeCompletedAudio(audio, sessionId, completedAt).finally(() => {
      if (this.activeSessionId === sessionId) this.finalizing = false;
    });
  }

  private async decodeCompletedAudio(
    audio: Float32Array,
    sessionId: number | null,
    completedAt: number
  ): Promise<void> {
    if (!audio.length) {
      this.callbacks?.onError(new Error('没有录到可识别的音频。'));
      this.callbacks?.onEnd?.();
      return;
    }

    const transferStartedAt = nowMs();
    try {
      const text = await this.decode(audio);
      if (this.activeSessionId !== sessionId) return;
      const finalText = normalizeTranscript(text);
      if (!hasSpeechContent(finalText)) {
        this.callbacks?.onTranscript('', true);
        return;
      }
      const doneAt = nowMs();
      this.callbacks?.onTimings?.({
        correctionMs: Math.max(0, doneAt - transferStartedAt),
        recordingMs: this.recordingMs,
        transcriptionMs: Math.max(0, doneAt - transferStartedAt),
        transmissionMs: Math.max(0, transferStartedAt - completedAt)
      });
      this.callbacks?.onTranscript(finalText, true);
    } catch (error) {
      if (this.activeSessionId === sessionId) this.callbacks?.onError(toError(error));
    } finally {
      if (this.activeSessionId === sessionId) this.callbacks?.onEnd?.();
    }
  }

  private decode(audio: Float32Array): Promise<string> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('SenseVoice worker is not ready.'));
    const id = ++this.decodeId;
    this.log('sending audio to worker', {
      id,
      samples: audio.length,
      durationMs: Math.round((audio.length / TARGET_SAMPLE_RATE) * 1000)
    });
    return new Promise((resolve, reject) => {
      this.pendingDecodes.set(id, { resolve, reject });
      worker.postMessage({ type: 'decode', id, sampleRate: TARGET_SAMPLE_RATE, audioBuffer: audio.buffer }, [
        audio.buffer
      ]);
    });
  }

  private handleWorkerMessage(message: WorkerMessage): void {
    if (message.type === 'decode-result') {
      const pending = this.pendingDecodes.get(message.id);
      if (!pending) return;
      this.pendingDecodes.delete(message.id);
      this.log('worker returned transcript', {
        id: message.id,
        elapsedMs: Math.round(message.elapsedMs),
        text: message.result.text ?? ''
      });
      pending.resolve(message.result.text ?? '');
      return;
    }
    if (message.type === 'decode-error') {
      const pending = this.pendingDecodes.get(message.id);
      if (!pending) return;
      this.pendingDecodes.delete(message.id);
      this.log('worker returned decode error', { id: message.id, message: message.message });
      pending.reject(new Error(message.message));
      return;
    }
    if (message.type === 'vad-event') {
      this.handleVadEvent(message);
      return;
    }
    if (message.type === 'vad-error') {
      this.callbacks?.onError(new Error(message.message));
    }
  }

  private handleVadEvent(message: WorkerVadEventMessage): void {
    if (message.event === 'speech-start') {
      this.startRecording();
      return;
    }
    if (message.event === 'speech-end') {
      if (!this.utteranceActive || !message.audioBuffer) return;
      const completedAt = nowMs();
      this.recordingMs = Math.max(0, completedAt - (this.speechStartedAt ?? completedAt));
      const audio = new Float32Array(message.audioBuffer);
      this.log('VAD speech ended', {
        sessionId: this.activeSessionId,
        recordingMs: Math.round(this.recordingMs),
        frames: Math.max(1, Math.ceil(audio.length / VAD_FRAME_SIZE)),
        samples: audio.length,
        peak: Number(peakAmplitude(audio).toFixed(5)),
        audioMs: Math.round((audio.length / TARGET_SAMPLE_RATE) * 1000),
        start: message.start
      });
      const sessionId = this.activeSessionId;
      this.resetActiveUtterance();
      void this.decodeCompletedAudio(audio, sessionId, completedAt);
      return;
    }
    if (message.event === 'vad-misfire') {
      this.resetActiveUtterance();
      this.callbacks?.onEnd?.();
    }
  }

  private resetActiveUtterance(): void {
    this.utteranceActive = false;
    this.utteranceChunks.length = 0;
    this.speechStartedAt = null;
    this.capturedFrameCount = 0;
    this.capturedSampleCount = 0;
    this.capturedPeak = 0;
  }

  private resetSentenceAssembly(): void {
    this.resetActiveUtterance();
    this.finalizing = false;
    this.recordingMs = 0;
  }

  private clearInputWatchdog(): void {
    if (this.inputWatchdog === null) return;
    window.clearTimeout(this.inputWatchdog);
    this.inputWatchdog = null;
  }

  private log(event: string, details?: Record<string, unknown>): void {
    console.info(`[SenseVoice] ${event}`, details ?? '');
  }
}

export function hasSpeechContent(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

function nowMs(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext ??
    null
  );
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
