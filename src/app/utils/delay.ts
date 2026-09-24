export class AbortError extends Error {
  constructor(message = 'Operation aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AbortError();
  }
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);

  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = (): void => {
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      reject(new AbortError());
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function isAbortError(error: unknown): boolean {
  return error instanceof AbortError || (error instanceof Error && error.name === 'AbortError');
}
