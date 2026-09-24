import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONTEXT_MESSAGE_LIMIT,
  MAX_CONTEXT_MESSAGE_LIMIT,
  MIN_CONTEXT_MESSAGE_LIMIT,
  normalizeContextMessageLimit,
  validateChatTurnRequest
} from './ChatTurnContracts';

/** Mirrors the minimal payload the gateway accepts (see RealtimeGatewayServer.test.ts). */
function chatTurnRequest(contextMessageLimit?: unknown): Record<string, unknown> {
  return {
    message: { id: 'msg-1', role: 'user', text: '你好', createdAt: 1 },
    llmConfig: { provider: 'openai', baseUrl: 'https://example.com', model: 'gpt', apiKey: 'k' },
    personality: {
      id: 'p',
      displayName: 'Shiro',
      identity: '',
      traits: [],
      speakingStyle: [],
      boundaries: [],
      defaultEmotion: 'neutral'
    },
    personalityState: {
      mood: 'neutral',
      energy: 0.5,
      engagement: 0.5,
      lastInteractionAt: 0,
      recentTopics: [],
      frozen: false
    },
    soulContext: '',
    webSearchEnabled: false,
    ttsLanguage: 'ja',
    ...(contextMessageLimit === undefined ? {} : { contextMessageLimit })
  };
}

describe('normalizeContextMessageLimit', () => {
  it('falls back to the default for missing or unparsable values', () => {
    expect(normalizeContextMessageLimit(undefined)).toBe(DEFAULT_CONTEXT_MESSAGE_LIMIT);
    expect(normalizeContextMessageLimit(null)).toBe(DEFAULT_CONTEXT_MESSAGE_LIMIT);
    expect(normalizeContextMessageLimit('')).toBe(DEFAULT_CONTEXT_MESSAGE_LIMIT);
    expect(normalizeContextMessageLimit('many')).toBe(DEFAULT_CONTEXT_MESSAGE_LIMIT);
  });

  it('clamps anything outside the supported range', () => {
    expect(normalizeContextMessageLimit(0)).toBe(MIN_CONTEXT_MESSAGE_LIMIT);
    expect(normalizeContextMessageLimit(-12)).toBe(MIN_CONTEXT_MESSAGE_LIMIT);
    expect(normalizeContextMessageLimit(9_999)).toBe(MAX_CONTEXT_MESSAGE_LIMIT);
  });

  it('accepts numbers and numeric strings in range', () => {
    expect(normalizeContextMessageLimit(12)).toBe(12);
    expect(normalizeContextMessageLimit('12')).toBe(12);
    expect(normalizeContextMessageLimit(16.4)).toBe(16);
  });
});

describe('validateChatTurnRequest contextMessageLimit', () => {
  it('always hands the server a concrete number, even when the field is omitted', () => {
    expect(validateChatTurnRequest(chatTurnRequest()).contextMessageLimit).toBe(
      DEFAULT_CONTEXT_MESSAGE_LIMIT
    );
  });

  it('clamps what the page asked for instead of trusting it', () => {
    expect(validateChatTurnRequest(chatTurnRequest(500)).contextMessageLimit).toBe(
      MAX_CONTEXT_MESSAGE_LIMIT
    );
    expect(validateChatTurnRequest(chatTurnRequest(1)).contextMessageLimit).toBe(
      MIN_CONTEXT_MESSAGE_LIMIT
    );
  });

  it('rejects a non-numeric limit rather than silently defaulting', () => {
    expect(() => validateChatTurnRequest(chatTurnRequest('many'))).toThrow(TypeError);
  });
});
