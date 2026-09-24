import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_STORAGE_KEY,
  CHAT_WINDOW_STORAGE_KEY,
  loadChatMessages,
  loadChatWindowState,
  saveChatMessages
} from './chatStorage';

afterEach(() => vi.unstubAllGlobals());

function mockStorage(key: string, value: unknown) {
  const values = new Map([[key, JSON.stringify(value)]]);
  vi.stubGlobal('localStorage', {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, text: string) => values.set(name, text)
  });
}

describe('chat persistence', () => {
  it('discards malformed history entries before they reach the UI or LLM', () => {
    const valid = { id: 'ok', role: 'user' as const, text: '你好', createdAt: 1 };
    mockStorage(CHAT_STORAGE_KEY, [
      null,
      { text: 'missing identity' },
      { ...valid, role: 'system' },
      { ...valid, createdAt: 'yesterday' },
      valid
    ]);
    expect(loadChatMessages()).toEqual([valid]);
  });

  it('persists only the most recent 40 complete messages in chronological order', () => {
    mockStorage(CHAT_STORAGE_KEY, []);
    const messages = Array.from({ length: 50 }, (_, index) => ({
      id: String(index),
      role: 'user' as const,
      text: `message ${index}`,
      createdAt: index
    }));
    saveChatMessages(messages);
    expect(loadChatMessages()).toEqual(messages.slice(10));
  });

  it('removes legacy inline source links when a source card already exists', () => {
    mockStorage(CHAT_STORAGE_KEY, [
      {
        id: 'answer',
        role: 'assistant',
        text: '人物摘要。 [来源](https://example.com/person)',
        createdAt: 1,
        kind: 'web-search',
        sources: [{ title: '人物资料', url: 'https://example.com/person', snippet: '人物摘要。' }]
      }
    ]);

    expect(loadChatMessages()[0].text).toBe('人物摘要。');
  });

  it('restores valid window coordinates and rejects invalid ones', () => {
    mockStorage(CHAT_WINDOW_STORAGE_KEY, { x: 40, y: 'top', minimized: true });
    expect(loadChatWindowState()).toEqual({ x: 40, y: null, minimized: true });
  });
});
