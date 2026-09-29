/** The meeting window owns the conversation queue; the stage only issues UI commands. */
export const STAGE_MEETING_CHANNEL = 'servant.stage-meeting.v1';
export type StageMeetingCommand =
  | { type: 'send'; sessionId: string; text: string; speakerId: string }
  | { type: 'participant'; sessionId: string; characterId: string }
  | { type: 'interrupt'; sessionId: string }
  | { type: 'control'; sessionId: string; action: 'continue' | 'all' | 'auto' | 'pause' };
export function isStageMeetingCommand(value: unknown): value is StageMeetingCommand {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  if (typeof data.sessionId !== 'string') return false;
  return data.type === 'interrupt' || (data.type === 'control' && ['continue', 'all', 'auto', 'pause'].includes(String(data.action))) ||
    (data.type === 'participant' && typeof data.characterId === 'string') ||
    (data.type === 'send' && typeof data.text === 'string' && data.text.trim().length > 0 && data.text.length <= 4000 && typeof data.speakerId === 'string');
}
export function sendStageMeetingCommand(command: StageMeetingCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    const channel = new BroadcastChannel(STAGE_MEETING_CHANNEL);
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { channel.close(); reject(new Error('多人对话窗口未响应，请从“更多”打开多人对话后重试。')); }, 8000);
    channel.onmessage = ({ data }) => {
      if (data?.requestId !== requestId || data?.type !== 'ack') return;
      clearTimeout(timer);
      channel.close();
      if (data.error) reject(new Error(data.error)); else resolve();
    };
    channel.postMessage({ requestId, command });
  });
}
