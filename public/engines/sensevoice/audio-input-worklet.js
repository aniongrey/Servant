class SenseVoiceAudioInputProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const processorOptions = options.processorOptions || {};
    this.targetSampleRate = processorOptions.targetSampleRate || 16000;
    this.inputSampleRate = processorOptions.inputSampleRate || sampleRate;
    this.frameSize = processorOptions.frameSize || 512;
    this.pending = new Float32Array(0);
    this.resampleBuffer = new Float32Array(0);
    this.resamplePosition = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input?.length) return true;

    const resampled = this.resample(input);

    this.pending = appendSamples(this.pending, resampled);
    while (this.pending.length >= this.frameSize) {
      const frame = this.pending.slice(0, this.frameSize);
      this.pending = this.pending.slice(this.frameSize);
      this.port.postMessage({ type: 'frame', audioBuffer: frame.buffer }, [frame.buffer]);
    }
    return true;
  }

  resample(input) {
    if (this.inputSampleRate === this.targetSampleRate) return new Float32Array(input);

    this.resampleBuffer = appendSamples(this.resampleBuffer, input);
    const ratio = this.inputSampleRate / this.targetSampleRate;
    const samples = [];
    while (this.resamplePosition + 1 < this.resampleBuffer.length) {
      const before = Math.floor(this.resamplePosition);
      const weight = this.resamplePosition - before;
      samples.push(
        this.resampleBuffer[before] * (1 - weight)
        + this.resampleBuffer[before + 1] * weight
      );
      this.resamplePosition += ratio;
    }

    const consumed = Math.min(Math.floor(this.resamplePosition), Math.max(0, this.resampleBuffer.length - 1));
    if (consumed > 0) {
      this.resampleBuffer = this.resampleBuffer.slice(consumed);
      this.resamplePosition -= consumed;
    }
    return Float32Array.from(samples);
  }
}

function appendSamples(before, after) {
  if (!before.length) return after;
  if (!after.length) return before;
  const output = new Float32Array(before.length + after.length);
  output.set(before);
  output.set(after, before.length);
  return output;
}

registerProcessor('sensevoice-audio-input', SenseVoiceAudioInputProcessor);
