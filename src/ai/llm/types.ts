export type ConversationPhase =
  | 'idle'
  | 'initializing'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'typing'
  | 'error';
export type ConversationRole = 'user' | 'assistant';
export const PERSONALITY_MOODS = ['neutral', 'happy', 'curious', 'concerned', 'angry', 'sad', 'shy'] as const;
export type PersonalityMood = (typeof PERSONALITY_MOODS)[number];
export type SpeechOutputLanguage = 'zh' | 'ja' | 'en' | 'ko';
export const MEMOIR_CATEGORIES = ['profile', 'preference', 'relationship', 'experience', 'plan'] as const;
export type MemoirCategory = (typeof MEMOIR_CATEGORIES)[number];
export const MEMORY_TYPES = [
  'profile',
  'preference',
  'relationship',
  'event',
  'plan',
  'health',
  'other'
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export interface ExtractedMemoryCandidate {
  memoryType: MemoryType;
  summary: string;
  people: string[];
  keywords: string[];
  eventTimeStart: string | null;
  eventTimeEnd: string | null;
  importance: number;
  sourceMessageIds: string[];
}

export interface ChatMessage {
  id: string;
  role: ConversationRole;
  text: string;
  createdAt: number;
  kind?: 'dialogue' | 'web-search' | 'system';
  sources?: WebSearchMessageSource[];
}

export interface WebSearchMessageSource {
  title: string;
  url: string;
  snippet: string;
}

export interface PersonalityConfig {
  id: string;
  displayName: string;
  identity: string;
  traits: string[];
  speakingStyle: string[];
  boundaries: string[];
  defaultEmotion: PersonalityMood;
  skillContent?: string;
  additionalPrompt?: string;
}

export interface PersonalityState {
  mood: PersonalityMood;
  energy: number;
  engagement: number;
  lastInteractionAt: number;
  recentTopics: string[];
  frozen: boolean;
}

export interface AssistantIntent {
  replies: AssistantReplySegment[];
  /** Combined display text retained for chat history and personality/memory consumers. */
  speech: string;
  /** Search results explicitly used by a deterministic answer. */
  sourceUrls?: string[];
  soulEvent: import('../../soul').SoulEventType;
  emotion: PersonalityMood;
  intensity: number;
  memories: MemoryCandidate[];
}

export type ChatToolName = 'web-search' | 'scheduler';

export interface ChatToolCall {
  name: ChatToolName;
  arguments: Record<string, unknown>;
}

export interface ChatToolDefinition {
  name: ChatToolName;
  description: string;
  arguments: string;
}

export type ChatModelResult =
  | { kind: 'reply'; intent: AssistantIntent }
  | { kind: 'tool-call'; call: ChatToolCall };

export interface AssistantReplySegment {
  speech: string;
  ttsEmotion?: string;
  /** 情绪：驱动角色表情与 B/C 档微动作。 */
  emotion: PersonalityMood;
  intensity: number;
  /** 组合动作 id（full-body-motion-config.json 的 emotion 键）：驱动身体 VRMA。 */
  shortAction: string;
}

export interface MemoryCandidate {
  category: MemoirCategory;
  title: string;
  content: string;
  importance: number;
}

export type AssistantStreamEvent =
  | { type: 'first-speech'; speech: string }
  | {
      type: 'first-parameters';
      emotion: PersonalityMood;
      intensity: number;
      shortAction: string;
    }
  | { type: 'intent'; intent: AssistantIntent };

export interface LlmModelInfo {
  name: string;
  model: string;
}
