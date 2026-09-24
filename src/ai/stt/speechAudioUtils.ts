export function resampleLinear(
  input: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number
): Float32Array {
  if (!input.length || inputSampleRate <= 0 || outputSampleRate <= 0) return new Float32Array();
  if (inputSampleRate === outputSampleRate) return new Float32Array(input);
  const outputLength = Math.max(1, Math.round((input.length * outputSampleRate) / inputSampleRate));
  const output = new Float32Array(outputLength);
  const ratio = inputSampleRate / outputSampleRate;
  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const before = Math.floor(sourceIndex);
    const after = Math.min(input.length - 1, before + 1);
    const weight = sourceIndex - before;
    output[index] = input[before] * (1 - weight) + input[after] * weight;
  }
  return output;
}

export function concatAudioChunks(chunks: readonly Float32Array[]): Float32Array {
  const output = new Float32Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export function peakAmplitude(samples: Float32Array): number {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

export function normalizeTranscript(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}
