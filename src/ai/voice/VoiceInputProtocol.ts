import type { SpeechPipelineTimings } from '../stt/speechRecognitionTypes';

export interface VoiceTarget {
  page: 'chat' | 'meeting' | 'desktop';
  sessionId: string;
  characterId: string;
  label: string;
}
export interface VoiceEndpoint {
  id: string;
  target: VoiceTarget | null;
  focused: boolean;
  updatedAt: number;
}
export interface VoiceResult {
  id: string;
  endpointId: string;
  target: VoiceTarget;
  text: string;
  autoSend: boolean;
  timings?: SpeechPipelineTimings;
}
export interface VoiceInputState {
  ready: boolean;
  enabled: boolean;
  phase: 'idle' | 'initializing' | 'listening' | 'recording' | 'transcribing' | 'paused';
  targetLabel: string;
  error: string;
  pending: VoiceResult[];
}
export const emptyVoiceState: VoiceInputState = {
  ready: false,
  enabled: false,
  phase: 'idle',
  targetLabel: '',
  error: '',
  pending: []
};
// Shared by BroadcastChannel and Tauri; native event names cannot contain dots.
export const VOICE_INPUT_CHANNEL = 'servant:voice-input:v1';
export const VOICE_INBOX_KEY = 'servant.voice-inbox.v1';
export type VoiceCommand =
  | { type: 'endpoint'; endpoint: VoiceEndpoint }
  | { type: 'leave'; id: string }
  | { type: 'press' | 'release' | 'stop' | 'retry'; id: string }
  | { type: 'ack'; id: string; resultId: string }
  | { type: 'recover'; id: string; resultId: string };
export type VoiceEvent =
  | { type: 'stopped' }
  | { type: 'state'; state: VoiceInputState }
  | { type: 'result'; result: VoiceResult }
  | { type: 'interrupt'; id: string; target: VoiceTarget };
export function sameVoiceTarget(a: VoiceTarget | null, b: VoiceTarget | null): boolean {
  return !!a && !!b && a.page === b.page && a.sessionId === b.sessionId && a.characterId === b.characterId;
}
export function isVoiceTarget(value: unknown): value is VoiceTarget {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    ['chat', 'meeting', 'desktop'].includes(String(v.page)) &&
    ['sessionId', 'characterId', 'label'].every(
      (key) => typeof v[key] === 'string' && (v[key] as string).length > 0 && (v[key] as string).length <= 500
    )
  );
}
export function isVoiceCommand(value: unknown): value is VoiceCommand {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.type === 'endpoint') {
    const e = v.endpoint as VoiceEndpoint | undefined;
    return (
      !!e &&
      typeof e.id === 'string' &&
      e.id.length <= 200 &&
      typeof e.focused === 'boolean' &&
      (e.target === null || isVoiceTarget(e.target))
    );
  }
  if (typeof v.id !== 'string' || v.id.length > 200) return false;
  return (
    ['leave', 'press', 'release', 'stop', 'retry'].includes(String(v.type)) ||
    (['ack', 'recover'].includes(String(v.type)) && typeof v.resultId === 'string')
  );
}
export function isVoiceResult(value: unknown): value is VoiceResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.endpointId === 'string' &&
    isVoiceTarget(v.target) &&
    typeof v.text === 'string' &&
    v.text.length <= 100_000 &&
    typeof v.autoSend === 'boolean' &&
    (v.timings === undefined ||
      (!!v.timings &&
        typeof v.timings === 'object' &&
        ['correctionMs', 'recordingMs', 'transcriptionMs', 'transmissionMs'].every((key) =>
          Number.isFinite((v.timings as Record<string, unknown>)[key])
        )))
  );
}
export function isVoiceEvent(value: unknown): value is VoiceEvent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.type === 'stopped') return true;
  if (v.type === 'result') return isVoiceResult(v.result);
  if (v.type === 'interrupt') return typeof v.id === 'string' && isVoiceTarget(v.target);
  if (v.type !== 'state' || !v.state || typeof v.state !== 'object') return false;
  const s = v.state as Record<string, unknown>;
  return (
    typeof s.ready === 'boolean' &&
    typeof s.enabled === 'boolean' &&
    typeof s.error === 'string' &&
    typeof s.targetLabel === 'string' &&
    ['idle', 'initializing', 'listening', 'recording', 'transcribing', 'paused'].includes(String(s.phase)) &&
    Array.isArray(s.pending) &&
    s.pending.every(isVoiceResult)
  );
}
export function selectVoiceEndpoint(
  endpoints: Iterable<VoiceEndpoint>,
  background: boolean,
  now: number
): VoiceEndpoint | undefined {
  const live = [...endpoints].filter((item) => item.target && now - item.updatedAt < 6000);
  return (
    live.filter((item) => item.focused).sort((a, b) => b.updatedAt - a.updatedAt)[0] ??
    (background
      ? live.sort((a, b) => {
          const priority = { desktop: 0, meeting: 1, chat: 2 };
          return priority[a.target!.page] - priority[b.target!.page] || b.updatedAt - a.updatedAt;
        })[0]
      : undefined)
  );
}
