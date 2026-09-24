export interface StreamingTextSegmenterOptions {
  maxChars?: number;
  minSoftBreakChars?: number;
}

const HARD_BREAK = /[。！？!?；;\n]/;
const SOFT_BREAK = /[，,、：:]/;

export interface FirstSentenceSplit {
  firstSentence: string;
  remainder: string;
}

export function splitFirstSentence(text: string): FirstSentenceSplit | undefined {
  const end = findFirstMatch(text, HARD_BREAK);
  if (end < 0) return undefined;
  const firstSentence = text.slice(0, end + 1).trim();
  if (!firstSentence) return undefined;
  return { firstSentence, remainder: text.slice(end + 1).trim() };
}

export class StreamingTextSegmenter {
  private partial = '';
  private consumedChars = 0;
  private buffer = '';
  private readonly maxChars: number;
  private readonly minSoftBreakChars: number;

  constructor(options: StreamingTextSegmenterOptions = {}) {
    this.maxChars = Math.max(8, options.maxChars ?? 24);
    this.minSoftBreakChars = Math.max(4, Math.min(this.maxChars, options.minSoftBreakChars ?? 10));
  }

  push(partialSpeech: string): string[] {
    if (!partialSpeech.startsWith(this.partial)) {
      if (partialSpeech.length <= this.consumedChars) return [];
      this.partial = partialSpeech.slice(0, this.consumedChars);
    }

    const delta = partialSpeech.slice(this.partial.length);
    this.partial = partialSpeech;
    this.buffer += delta;
    return this.takeReadySegments();
  }

  flush(finalSpeech?: string): string[] {
    const ready = finalSpeech === undefined ? [] : this.push(finalSpeech);
    const tail = this.buffer.trim();
    if (tail) {
      ready.push(tail);
      this.consumedChars += this.buffer.length;
    }
    this.buffer = '';
    return ready;
  }

  private takeReadySegments(): string[] {
    const segments: string[] = [];
    while (this.buffer) {
      const hardBreakIndex = findFirstMatch(this.buffer, HARD_BREAK);
      if (hardBreakIndex >= 0) {
        this.takeSegment(hardBreakIndex + 1, segments);
        continue;
      }
      if (this.buffer.length < this.maxChars) break;

      const softBreakIndex = findLastMatch(
        this.buffer.slice(this.minSoftBreakChars - 1, this.maxChars),
        SOFT_BREAK
      );
      const end = softBreakIndex >= 0 ? this.minSoftBreakChars - 1 + softBreakIndex + 1 : this.maxChars;
      this.takeSegment(end, segments);
    }
    return segments;
  }

  private takeSegment(end: number, segments: string[]): void {
    const raw = this.buffer.slice(0, end);
    const text = raw.trim();
    this.buffer = this.buffer.slice(end);
    this.consumedChars += raw.length;
    if (text) segments.push(text);
  }
}

function findFirstMatch(text: string, pattern: RegExp): number {
  for (let index = 0; index < text.length; index += 1) {
    if (pattern.test(text[index])) return index;
  }
  return -1;
}

function findLastMatch(text: string, pattern: RegExp): number {
  for (let index = text.length - 1; index >= 0; index -= 1) {
    if (pattern.test(text[index])) return index;
  }
  return -1;
}
