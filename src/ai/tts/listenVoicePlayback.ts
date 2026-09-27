import { RealtimeGatewayClient } from '../../app/network/realtime/RealtimeGatewayClient';
import { isRecord } from '../../app/network/realtime/RealtimeProtocol';
import { ACTION_VOICE_TOPIC, parseVoiceStreamEvent, type VoiceStreamEvent } from '../../app/network/realtime/VoiceStreamProtocol';

/** Broadcast observers may be numerous; only one renderer may speak a given turn. */
export function listenVoicePlayback(
  handler: (event: VoiceStreamEvent) => void,
  onDisconnect: () => void,
  client = new RealtimeGatewayClient()
): () => void {
  const turns = new Map<string, { granted?: boolean; pending: VoiceStreamEvent[] }>();
  const requests = new Map<string, string>();
  const offMessage = client.onMessage((message) => {
    if (message.type !== 'ack' && message.type !== 'error') return;
    const key = message.requestId ? requests.get(message.requestId) : undefined;
    if (!key) return;
    requests.delete(message.requestId!);
    const turn = turns.get(key);
    if (!turn) return;
    turn.granted = message.type === 'ack' && isRecord(message.payload) && message.payload.granted === true;
    const pending = turn.pending.splice(0);
    if (turn.granted) pending.forEach(handler);
    if (message.type === 'error') console.error('[VoicePlayback] claim failed:', message.message);
  });
  const offEvent = client.on(ACTION_VOICE_TOPIC, (payload) => {
    const event = parseVoiceStreamEvent(payload);
    if (!event || event.source !== 'conversation' || event.type.startsWith('speech-playback-')) return;
    const key = JSON.stringify([event.id, event.characterId ?? null]);
    const starts = event.type === 'speech-start' || event.type === 'reply-stream-start' || event.type === 'reply-sequence';
    let turn = turns.get(key);
    if (starts) {
      if (turn) return; // Duplicate start must not restart a sentence.
      turn = { pending: [event] };
      turns.set(key, turn);
      if (turns.size > 2048) turns.delete(turns.keys().next().value!);
      const requestId = crypto.randomUUID();
      requests.set(requestId, key);
      if (!client.sendCommand(ACTION_VOICE_TOPIC, 'claim-playback', { id: event.id, characterId: event.characterId }, requestId)) {
        requests.delete(requestId);
        turn.granted = false;
        turn.pending.length = 0;
      }
      return;
    }
    if (turn?.granted) handler(event);
    else if (turn && turn.granted === undefined) turn.pending.push(event);
  });
  const offState = client.onStateChange((state) => {
    if (state !== 'disconnected') return;
    turns.clear();
    requests.clear();
    onDisconnect();
  });
  client.connect();
  return () => {
    offEvent();
    offMessage();
    offState();
    client.close();
    turns.clear();
    requests.clear();
  };
}
