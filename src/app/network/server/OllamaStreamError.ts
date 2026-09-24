const MAX_INITIAL_LINE_BYTES = 64 * 1024;

export interface OllamaStreamStart {
  chunks: Uint8Array[];
  done: boolean;
  error?: string;
}

/** Reads a complete initial NDJSON line so a split Ollama error never reaches the provider parser. */
export async function readOllamaStreamStart(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<OllamaStreamStart> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.value) {
      chunks.push(next.value);
      size += next.value.byteLength;
    }
    const firstLine = firstLineBytes(chunks, size);
    if (firstLine || next.done || size >= MAX_INITIAL_LINE_BYTES) {
      const candidate = firstLine ?? combineChunks(chunks, size);
      return { chunks, done: Boolean(next.done), error: readOllamaStreamError(candidate) };
    }
  }
}

function firstLineBytes(chunks: readonly Uint8Array[], size: number): Uint8Array | undefined {
  if (size === 0) return undefined;
  const combined = combineChunks(chunks, size);
  const newline = combined.indexOf(10);
  return newline >= 0 ? combined.slice(0, newline) : undefined;
}

function combineChunks(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function readOllamaStreamError(chunk: Uint8Array): string | undefined {
  try {
    const value = JSON.parse(new TextDecoder().decode(chunk).trim()) as { error?: unknown };
    return typeof value.error === 'string'
      ? value.error
      : value.error && typeof value.error === 'object' && typeof (value.error as { message?: unknown }).message === 'string'
      ? (value.error as { message: string }).message
      : undefined;
  } catch {
    return undefined;
  }
}
