export interface SpeechPipelineTimings {
  correctionMs: number;
  recordingMs: number;
  transcriptionMs: number;
  transmissionMs: number;
}

export type SpeechSessionMode = 'manual' | 'realtime';

export interface SpeechRecognitionCallbacks {
  onTranscript: (text: string, isFinal: boolean) => void;
  onError: (error: Error) => void;
  onEnd?: () => void;
  onStarted?: () => void;
  onTimings?: (timings: SpeechPipelineTimings) => void;
  onSpeechStart?: () => void;
  mode?: SpeechSessionMode;
}

export interface SpeechRecognizer {
  isSupported(): boolean;
  isReady(): boolean;
  preload(): Promise<void>;
  listen(
    onFinal?: (text: string) => void,
    onStarted?: () => void,
    onTimings?: (timings: SpeechPipelineTimings) => void
  ): Promise<string>;
  startContinuous(callbacks: SpeechRecognitionCallbacks): void;
  finishCurrentUtterance(): boolean;
  abort(): void;
  destroy(): void;
}
