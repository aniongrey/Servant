import {
  createDefaultPersonalityState,
  normalizePersonalityState
} from '../../ai/personality/PersonalitySystem';
import { type ChatMessage, type PersonalityConfig, type PersonalityState } from '../../ai/llm/types';
import { type ChatWindowState } from './chatTypes';

export const CHAT_STORAGE_KEY = 'codex-list.companionChat.v1';

export const PERSONALITY_STORAGE_KEY = 'codex-list.personalityState.v1';

export const CHAT_WINDOW_STORAGE_KEY = 'codex-list.companionChatWindow.v1';

export function loadChatMessages(): ChatMessage[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter(isChatMessage).slice(-40).map(removeLegacyInlineSourceLink)
      : [];
  } catch {
    return [];
  }
}

function removeLegacyInlineSourceLink(message: ChatMessage): ChatMessage {
  if (!message.sources?.length) return message;
  const text = message.text.replace(/\s*\[来源\]\(https?:\/\/[^)]+\)/g, '').trim();
  return text === message.text ? message : { ...message, text };
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<ChatMessage>;
  const sourcesValid =
    message.sources === undefined ||
    (Array.isArray(message.sources) &&
      message.sources.every(
        (source) =>
          source &&
          typeof source === 'object' &&
          typeof source.title === 'string' &&
          typeof source.url === 'string' &&
          /^https?:\/\//i.test(source.url) &&
          typeof source.snippet === 'string'
      ));
  return (
    typeof message.id === 'string' &&
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.text === 'string' &&
    typeof message.createdAt === 'number' &&
    Number.isFinite(message.createdAt) &&
    (message.kind === undefined || message.kind === 'dialogue' || message.kind === 'web-search') &&
    sourcesValid
  );
}

export function saveChatMessages(messages: ChatMessage[]): void {
  if (typeof localStorage !== 'undefined')
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages.slice(-40)));
}

export function loadPersonalityState(config: PersonalityConfig): PersonalityState {
  if (typeof localStorage === 'undefined') return createDefaultPersonalityState(config);
  try {
    return normalizePersonalityState(
      JSON.parse(localStorage.getItem(PERSONALITY_STORAGE_KEY) ?? 'null') as
        | Partial<PersonalityState>
        | undefined,
      config
    );
  } catch {
    return createDefaultPersonalityState(config);
  }
}

export const loadingPersonalityConfig: PersonalityConfig = {
  id: 'loading',
  displayName: '加载中',
  identity: '',
  traits: [],
  speakingStyle: [],
  boundaries: [],
  defaultEmotion: 'neutral'
};

export function savePersonalityState(state: PersonalityState): void {
  if (typeof localStorage !== 'undefined')
    localStorage.setItem(PERSONALITY_STORAGE_KEY, JSON.stringify(state));
}

export function loadChatWindowState(): ChatWindowState {
  if (typeof localStorage === 'undefined') return { x: null, y: null, minimized: false };
  try {
    const value = JSON.parse(
      localStorage.getItem(CHAT_WINDOW_STORAGE_KEY) ?? 'null'
    ) as Partial<ChatWindowState> | null;
    return {
      x: typeof value?.x === 'number' && Number.isFinite(value.x) ? value.x : null,
      y: typeof value?.y === 'number' && Number.isFinite(value.y) ? value.y : null,
      minimized: value?.minimized === true
    };
  } catch {
    return { x: null, y: null, minimized: false };
  }
}

export function saveChatWindowState(state: ChatWindowState): void {
  if (typeof localStorage !== 'undefined')
    localStorage.setItem(CHAT_WINDOW_STORAGE_KEY, JSON.stringify(state));
}
