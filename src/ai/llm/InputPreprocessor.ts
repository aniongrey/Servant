import type { ChatToolName } from './types';
import { requiresSchedulerTool, requiresWebSearchTool, shouldUseSchedulerTool } from './ConversationTriggers';

const SEARCH_CANDIDATE = /(?:搜索|搜一下|查一下|查询|联网|网上|最新|今天|新闻|价格|现在|天气|汇率|股价)/;
const OBVIOUS_ASR_NOISE = /^(?:\[BLANK_AUDIO\]|\[NO_SPEECH\]|<\|nospeech\|>|字幕由.+提供)$/i;

export interface ProcessedConversationInput {
  text: string;
  isEmpty: boolean;
  isLikelyNoise: boolean;
  toolCandidates: ChatToolName[];
  requiresSchedulerTool: boolean;
  requiresWebSearchTool: boolean;
}

/** Deterministic input facts only; semantic value still belongs to the main LLM. */
export function preprocessConversationInput(text: string): ProcessedConversationInput {
  const normalized = text.trim().replace(/[ \t]+/g, ' ');
  const toolCandidates: ChatToolName[] = [];
  const schedulerRequired = requiresSchedulerTool(normalized);
  const webSearchRequired = requiresWebSearchTool(normalized);
  if (SEARCH_CANDIDATE.test(normalized)) toolCandidates.push('web-search');
  if (shouldUseSchedulerTool(normalized)) toolCandidates.push('scheduler');
  return {
    text: normalized,
    isEmpty: normalized.length === 0,
    isLikelyNoise: OBVIOUS_ASR_NOISE.test(normalized),
    toolCandidates,
    requiresSchedulerTool: schedulerRequired,
    requiresWebSearchTool: webSearchRequired
  };
}
