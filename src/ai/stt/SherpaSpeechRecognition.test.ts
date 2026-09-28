import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SherpaSpeechRecognition, hasSpeechContent } from './SherpaSpeechRecognition';
import { createSenseVoiceConfig, createSileroVadConfig } from './sherpaSpeechConfig';
import { resampleLinear } from './speechAudioUtils';

describe('SherpaSpeechRecognition', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { AudioContext: class FakeAudioContext {} }
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { mediaDevices: { getUserMedia: vi.fn() } }
    });
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: class FakeWorker {}
    });
    Object.defineProperty(globalThis, 'AudioWorkletNode', {
      configurable: true,
      value: class FakeAudioWorkletNode {}
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'navigator');
    Reflect.deleteProperty(globalThis, 'Worker');
    Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
  });

  it('uses the local SenseVoice int8 offline configuration', () => {
    const config = createSenseVoiceConfig();

    expect(config.featConfig.sampleRate).toBe(16_000);
    expect(config.modelConfig).not.toHaveProperty('modelType');
    expect(config.modelConfig.tokens).toBe('/openllm-tokens.txt');
    expect(config.modelConfig.senseVoice).toMatchObject({
      model: '/openllm-model.int8.onnx',
      language: 'zh',
      useInverseTextNormalization: 1
    });
    expect(config.decodingMethod).toBe('greedy_search');
  });

  it('reports support only when browser audio, workers, wasm, and mic capture are available', () => {
    const recognition = new SherpaSpeechRecognition();

    expect(recognition.isSupported()).toBe(true);

    Reflect.deleteProperty(globalThis, 'Worker');
    expect(recognition.isSupported()).toBe(false);
  });

  it('uses fixed Silero VAD settings for realtime microphone segmentation', () => {
    const config = createSileroVadConfig();

    expect(config.sampleRate).toBe(16_000);
    expect(config.sileroVad).toMatchObject({
      model: '/openllm-silero-vad-v5.onnx',
      threshold: 0.35,
      minSilenceDuration: 0.32,
      minSpeechDuration: 0.096,
      windowSize: 512
    });
    expect(config.debug).toBe(0);
  });

  it('rejects preloading when local speech recognition is unsupported', async () => {
    Reflect.deleteProperty(globalThis, 'Worker');
    const recognition = new SherpaSpeechRecognition();

    await expect(recognition.preload()).rejects.toThrow('当前环境不支持本地语音识别。');
  });

  it('resamples microphone frames to 16kHz mono before offline recognition', () => {
    const input = new Float32Array([0, 1, 0, -1, 0, 1]);
    const output = resampleLinear(input, 48_000, 16_000);

    expect(output).toHaveLength(2);
    expect(Array.from(output)).toEqual([0, -1]);
  });

  it('releases a microphone permission result that arrives after a quick key release', async () => {
    let resolve!: (stream: MediaStream) => void;
    const getUserMedia = vi.mocked(navigator.mediaDevices.getUserMedia);
    getUserMedia.mockReturnValue(new Promise((done) => { resolve = done; }));
    const stopped = vi.fn();
    const started = vi.fn();
    const recognition = new SherpaSpeechRecognition();
    vi.spyOn(recognition, 'preload').mockResolvedValue();
    recognition.startContinuous({ mode: 'manual', onTranscript: vi.fn(), onError: vi.fn(), onStarted: started });
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    expect(recognition.finishCurrentUtterance()).toBe(false);
    resolve({ getTracks: () => [{ stop: stopped }] } as unknown as MediaStream);
    await vi.waitFor(() => expect(stopped).toHaveBeenCalledOnce());
    expect(started).not.toHaveBeenCalled();
  });

  it('does not reopen recording when the audio worklet finishes loading after cancellation', async () => {
    let resolve!: () => void;
    const stopped = vi.fn();
    const closed = vi.fn(async () => {});
    const addModule = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    window.AudioContext = class {
      sampleRate = 48000;
      audioWorklet = { addModule };
      close = closed;
    } as unknown as typeof AudioContext;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue({
      getTracks: () => [{ stop: stopped }],
      getAudioTracks: () => [{ addEventListener: vi.fn() }]
    } as unknown as MediaStream);
    const recognition = new SherpaSpeechRecognition();
    vi.spyOn(recognition, 'preload').mockResolvedValue();
    const started = vi.fn();
    recognition.startContinuous({ mode: 'manual', onTranscript: vi.fn(), onError: vi.fn(), onStarted: started });
    await vi.waitFor(() => expect(addModule).toHaveBeenCalledOnce());
    recognition.finishCurrentUtterance();
    resolve();
    await Promise.resolve(); await Promise.resolve();
    expect(stopped).toHaveBeenCalledOnce();
    expect(closed).toHaveBeenCalledOnce();
    expect(started).not.toHaveBeenCalled();
  });

  it('buffers next-sentence audio while decoding and rejects VAD events from an older capture', async () => {
    // Exercise the worker/audio boundary without loading an ONNX model in Node.
    const recognition = new SherpaSpeechRecognition();
    const pipe = recognition as unknown as {
      activeSessionId: number; sessionId: number; sessionMode: string;
      worker: { postMessage: ReturnType<typeof vi.fn> };
      callbacks: { onSpeechStart: ReturnType<typeof vi.fn>; onTranscript: ReturnType<typeof vi.fn> };
      decode(audio: Float32Array): Promise<string>;
      processInputFrame(audio: Float32Array): void;
      handleVadEvent(event: { event: string; sessionId: number; audioBuffer?: ArrayBuffer }): void;
    };
    pipe.activeSessionId = pipe.sessionId = 7;
    pipe.sessionMode = 'realtime';
    pipe.worker = { postMessage: vi.fn() };
    pipe.callbacks = { onSpeechStart: vi.fn(), onTranscript: vi.fn() };
    let decoded!: (value: string) => void;
    vi.spyOn(pipe, 'decode').mockImplementation(() => new Promise((resolve) => { decoded = resolve; }));
    pipe.handleVadEvent({ event: 'speech-start', sessionId: 6 });
    expect(pipe.callbacks.onSpeechStart).not.toHaveBeenCalled();
    pipe.handleVadEvent({ event: 'speech-start', sessionId: 7 });
    pipe.handleVadEvent({ event: 'speech-end', sessionId: 7, audioBuffer: new Float32Array([0.5]).buffer });
    const nextAudio = new Float32Array([0.25]);
    pipe.processInputFrame(nextAudio);
    expect(pipe.worker.postMessage).not.toHaveBeenCalled();
    decoded('第一句');
    await vi.waitFor(() => expect(pipe.worker.postMessage).toHaveBeenCalledWith(
      { type: 'vad-frame', sessionId: 7, audioBuffer: nextAudio.buffer }, [nextAudio.buffer]
    ));
    expect(pipe.callbacks.onTranscript).toHaveBeenCalledWith('第一句', true);
  });
});

describe('speech transcript content', () => {
  it('treats empty and punctuation-only ASR output as silence', () => {
    expect(hasSpeechContent('')).toBe(false);
    expect(hasSpeechContent('，。！？')).toBe(false);
    expect(hasSpeechContent('你好。')).toBe(true);
  });
});
