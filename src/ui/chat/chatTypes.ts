import { type AgentRuntime } from '../../ai/AgentRuntime';
import { type LlmConfig } from '../../ai/llm/LlmConfig';
import type { SpeechPipelineTimings, SpeechRecognizer } from '../../ai/stt/speechRecognitionTypes';
import { type SpeechSdkTtsLanguage } from '../../ai/tts/SpeechSdkTtsProvider';
import type { TtsEmotionMarkup } from '../../ai/tts/ttsEmotionMarkup';

export interface CompanionChatPanelProps {
  engine: AgentRuntime;
  ttsLanguage: SpeechSdkTtsLanguage;
  ttsEmotionMarkup?: TtsEmotionMarkup;
  networkFetch?: typeof globalThis.fetch;
  llmConfig?: LlmConfig;
  onLlmConfigChange?(config: LlmConfig): void;
  speechRecognition?: SpeechRecognizer;
}

export interface ChatWindowState {
  x: number | null;
  y: number | null;
  minimized: boolean;
}

export interface DragState {
  pointerId: number;
  offsetX: number;
  offsetY: number;
}

export interface VoiceTimingState extends SpeechPipelineTimings {
  llmResponseMs: number | null;
}

export type MessageSource = 'text' | 'voice' | 'system';

/**
 * The one line above the message list. It is a transient hint, not a permanent
 * state label: `terminal` marks the "没有更多了" variant, which fades out on its
 * own because it only answers the scroll gesture that triggered it.
 */
export interface ChatHistoryNotice {
  /** Changes whenever the hint is re-triggered, so the fade animation restarts. */
  readonly key: string;
  readonly text: string;
  readonly terminal: boolean;
}
