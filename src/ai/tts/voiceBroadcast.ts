import { RealtimeGatewayClient } from '../../app/network/realtime/RealtimeGatewayClient';
import { publishRealtimeCommand } from '../../app/network/realtime/RealtimeBroadcastPublisher';
import {
  ACTION_VOICE_TOPIC,
  parseVoiceStreamEvent,
  type VoiceStreamEvent
} from '../../app/network/realtime/VoiceStreamProtocol';

/** Publish/subscribe helpers for the `action.voice` stream (reply segments, speech playback). */
export type VoiceBroadcastEvent = VoiceStreamEvent;

export function publishVoiceBroadcast(event: VoiceBroadcastEvent, client?: RealtimeGatewayClient): void {
  if (client?.sendCommand(ACTION_VOICE_TOPIC, 'publish', event)) return;
  publishRealtimeCommand(ACTION_VOICE_TOPIC, 'publish', event);
}

export function listenVoiceBroadcast(handler: (event: VoiceBroadcastEvent) => void): () => void {
  const client = new RealtimeGatewayClient();
  const offEvent = client.on(ACTION_VOICE_TOPIC, (payload) => {
    const event = parseVoiceStreamEvent(payload);
    if (event) handler(event);
  });
  client.connect();
  return () => {
    offEvent();
    client.close();
  };
}
