import { expect, it, vi } from 'vitest';
import { createVoiceStreamFeature, type RealtimeFeatureContext } from '../../app/network/realtime/RealtimeGatewayServer';
import type { RealtimeGatewayClient } from '../../app/network/realtime/RealtimeGatewayClient';
import type { RealtimeServerMessage } from '../../app/network/realtime/RealtimeProtocol';
import type { VoiceStreamEvent } from '../../app/network/realtime/VoiceStreamProtocol';
import { DesktopConversationSpeechStream } from '../../desktop/tauri/DesktopConversationSpeechStream';
import { RuntimeStore } from '../../app/state/RuntimeStore';
import { BrowserSpeechSynthesisProvider } from './BrowserSpeechSynthesisProvider';
import { SpeechController } from './SpeechController';
import { TtsManager } from './TtsManager';
import { listenVoicePlayback } from './listenVoicePlayback';

it('allows only one of the Windows and role TTS renderers to play a broadcast, including buffered segments and duplicate starts', async () => {
  const feature = createVoiceStreamFeature();
  const nativeSpeak = vi.fn((utterance: SpeechSynthesisUtterance) => utterance.onend?.({} as SpeechSynthesisEvent));
  const roleSpeak = vi.fn(async () => undefined);
  const providers = [
    { id: 'role-tts', isSupported: () => true, speak: roleSpeak, cancel: vi.fn() },
    new BrowserSpeechSynthesisProvider(
      { speak: nativeSpeak, cancel: vi.fn(), getVoices: () => [] } as unknown as SpeechSynthesis,
      (text) => ({ text } as SpeechSynthesisUtterance)
    )
  ];
  const clients = providers.map((provider, index) => {
    const store = new RuntimeStore();
    const stream = new DesktopConversationSpeechStream(new SpeechController({}, store, 0, new TtsManager(provider, store)));
    const client = new TestClient(feature, String(index));
    const stop = listenVoicePlayback((event) => stream.handle(event), () => stream.dispose(), client as unknown as RealtimeGatewayClient);
    return { client, stop };
  });
  const start: VoiceStreamEvent = {
    type: 'reply-stream-start', id: 'meeting-1', characterId: 'alice', source: 'conversation',
    segment: { text: '你好。', spokenText: '你好。', emotion: 'neutral', intensity: 0.5, shortAction: 'stunned' }
  };
  const broadcast = (event: VoiceStreamEvent) => clients.forEach(({ client }) => client.event?.(event));
  try {
    broadcast(start);
    broadcast(start);
    broadcast({ ...start, type: 'reply-stream-segment', index: 1, segment: { ...start.segment, text: '再见。', spokenText: '再见。' } });
    broadcast({ type: 'reply-stream-end', id: start.id, characterId: 'alice', source: 'conversation', segmentCount: 2 });
    await vi.waitFor(() => expect(roleSpeak).toHaveBeenCalledTimes(2));
    expect(nativeSpeak).not.toHaveBeenCalled();
    clients[0].stop();
    // A disconnected owner does not transfer/replay its sentence. A new turn can
    // still use the explicitly selected Windows provider on the remaining client.
    clients[1].client.event?.(start);
    clients[1].client.event?.({ ...start, id: 'meeting-2' });
    clients[1].client.event?.({ type: 'reply-stream-end', id: 'meeting-2', characterId: 'alice', source: 'conversation', segmentCount: 1 });
    await vi.waitFor(() => expect(nativeSpeak).toHaveBeenCalledTimes(1));
  } finally {
    clients.forEach(({ stop }) => stop());
  }
});

class TestClient {
  event?: (payload: unknown) => void;
  message?: (message: RealtimeServerMessage) => void;
  constructor(private feature: ReturnType<typeof createVoiceStreamFeature>, private connectionId: string) {}
  on(_topic: string, handler: (payload: unknown) => void) { this.event = handler; return () => { this.event = undefined; }; }
  onMessage(handler: (message: RealtimeServerMessage) => void) { this.message = handler; return () => { this.message = undefined; }; }
  onStateChange() { return () => undefined; }
  connect() {}
  close() { this.feature.disconnect?.(this.connectionId); }
  sendCommand(feature: string, action: string, payload: unknown, id: string) {
    const context: RealtimeFeatureContext = { connectionId: this.connectionId, publish() {}, broadcast() {} };
    const result = this.feature.handle(context, { version: 1, type: 'command', feature, action, payload, id });
    void Promise.resolve(result).then((value) => this.message?.({ version: 1, type: 'ack', requestId: id, payload: value }));
    return true;
  }
}
