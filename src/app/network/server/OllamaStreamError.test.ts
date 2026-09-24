import { describe, expect, it } from 'vitest';
import { readOllamaStreamStart } from './OllamaStreamError';

describe('readOllamaStreamStart', () => {
  it('recognizes an Ollama error split across transport chunks', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"error":"model '));
        controller.enqueue(new TextEncoder().encode('not found"}\n'));
        controller.close();
      }
    });

    await expect(readOllamaStreamStart(stream.getReader())).resolves.toMatchObject({
      error: 'model not found'
    });
  });
});
