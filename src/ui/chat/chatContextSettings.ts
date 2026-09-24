import { readStoredJson, writeStoredJson } from '../../app/settings/browserStorage';
import { CHAT_CONTEXT_MESSAGE_LIMIT_STORAGE_KEY } from '../../app/settings/storageKeys';
import {
  DEFAULT_CONTEXT_MESSAGE_LIMIT,
  MAX_CONTEXT_MESSAGE_LIMIT,
  MIN_CONTEXT_MESSAGE_LIMIT,
  normalizeContextMessageLimit
} from '../../app/network/realtime/ChatTurnContracts';

/**
 * How much stored chat history the LLM gets as context. The value is a chat-page
 * preference but the range and the default belong to the chat-turn contract
 * (see `ChatTurnContracts.ts`), so both sides clamp with the same function and
 * the server never has to trust what the page sends.
 */
export { DEFAULT_CONTEXT_MESSAGE_LIMIT, MAX_CONTEXT_MESSAGE_LIMIT, MIN_CONTEXT_MESSAGE_LIMIT };

export const CHAT_CONTEXT_SETTINGS_CHANGED_EVENT = 'codex-list:chat-context-settings-changed';

export function loadChatContextMessageLimit(): number {
  const saved = readStoredJson(CHAT_CONTEXT_MESSAGE_LIMIT_STORAGE_KEY);
  return saved === undefined ? DEFAULT_CONTEXT_MESSAGE_LIMIT : normalizeContextMessageLimit(saved);
}

/** Stores the clamped value and returns what was actually written. */
export function saveChatContextMessageLimit(limit: number): number {
  const normalized = normalizeContextMessageLimit(limit);
  writeStoredJson(CHAT_CONTEXT_MESSAGE_LIMIT_STORAGE_KEY, normalized);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHAT_CONTEXT_SETTINGS_CHANGED_EVENT));
  return normalized;
}
