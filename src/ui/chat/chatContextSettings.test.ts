import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CONTEXT_MESSAGE_LIMIT,
  loadChatContextMessageLimit,
  MAX_CONTEXT_MESSAGE_LIMIT,
  MIN_CONTEXT_MESSAGE_LIMIT,
  saveChatContextMessageLimit
} from './chatContextSettings';
import { CHAT_CONTEXT_MESSAGE_LIMIT_STORAGE_KEY } from '../../app/settings/storageKeys';

afterEach(() => vi.unstubAllGlobals());

/** The node test environment has no localStorage; the module must not need one. */
function mockStorage(initial?: string): Map<string, string> {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(CHAT_CONTEXT_MESSAGE_LIMIT_STORAGE_KEY, initial);
  vi.stubGlobal('localStorage', {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, text: string) => values.set(name, text)
  });
  return values;
}

describe('chat context message limit', () => {
  it('starts at the contract default when nothing was saved', () => {
    mockStorage();
    expect(loadChatContextMessageLimit()).toBe(DEFAULT_CONTEXT_MESSAGE_LIMIT);
  });

  it('reads a saved value', () => {
    mockStorage('24');
    expect(loadChatContextMessageLimit()).toBe(24);
  });

  it('clamps a saved value that violates the range and survives corrupt JSON', () => {
    mockStorage('9999');
    expect(loadChatContextMessageLimit()).toBe(MAX_CONTEXT_MESSAGE_LIMIT);

    mockStorage('{not json');
    expect(loadChatContextMessageLimit()).toBe(DEFAULT_CONTEXT_MESSAGE_LIMIT);
  });

  it('persists the clamped value and reports what was written', () => {
    const values = mockStorage();
    expect(saveChatContextMessageLimit(0)).toBe(MIN_CONTEXT_MESSAGE_LIMIT);
    expect(values.get(CHAT_CONTEXT_MESSAGE_LIMIT_STORAGE_KEY)).toBe(String(MIN_CONTEXT_MESSAGE_LIMIT));
    expect(loadChatContextMessageLimit()).toBe(MIN_CONTEXT_MESSAGE_LIMIT);
  });

  it('works without a storage backend (SSR / node)', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadChatContextMessageLimit()).toBe(DEFAULT_CONTEXT_MESSAGE_LIMIT);
    expect(saveChatContextMessageLimit(12)).toBe(12);
  });
});
