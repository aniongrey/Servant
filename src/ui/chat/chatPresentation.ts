import {
  type ChatMessage,
  type ConversationPhase,
  type WebSearchMessageSource
} from '../../ai/llm/types';

export function createMessage(role: ChatMessage['role'], text: string): ChatMessage {
  return { id: crypto.randomUUID(), role, text, createdAt: Date.now() };
}

export function createWebSearchMessage(
  query: string,
  sources: WebSearchMessageSource[],
  speech = `已完成“${query}”的联网搜索，找到 ${sources.length} 条相关资料。`
): ChatMessage {
  return {
    ...createMessage('assistant', speech),
    kind: 'web-search',
    sources
  };
}

export function phaseLabel(phase: ConversationPhase): string {
  if (phase === 'initializing') return '正在加载 SenseVoice int8 本地语音模型…';
  if (phase === 'listening') return '正在听…';
  if (phase === 'transcribing') return 'SenseVoice 正在整句识别…';
  if (phase === 'thinking') return '对方正在输入…';
  if (phase === 'typing') return '对方正在输入…';
  return '';
}

export function formatDuration(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value < 1_000) return `${Math.round(value)}ms`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 2 : 1)}s`;
}

export function nowMs(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
