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
});

describe('speech transcript content', () => {
  it('treats empty and punctuation-only ASR output as silence', () => {
    expect(hasSpeechContent('')).toBe(false);
    expect(hasSpeechContent('，。！？')).toBe(false);
    expect(hasSpeechContent('你好。')).toBe(true);
  });
});
