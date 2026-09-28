import { isTauriDesktop } from '../../desktop/tauri/navigation';
import { VOICE_INPUT_CHANNEL, type VoiceCommand, type VoiceEvent } from './VoiceInputProtocol';

export async function voiceInputTransport(host: boolean, receive: (value: unknown) => void) {
  if (isTauriDesktop()) {
    const { listen, emit, emitTo } = await import('@tauri-apps/api/event');
    const close = await listen(`${VOICE_INPUT_CHANNEL}:${host ? 'command' : 'event'}`, (event) =>
      receive(event.payload)
    );
    return {
      send: (message: VoiceCommand | VoiceEvent) => {
        const request = host
          ? emit(`${VOICE_INPUT_CHANNEL}:event`, message)
          : emitTo('voice', `${VOICE_INPUT_CHANNEL}:command`, message);
        void request.catch((error) => console.error('[VoiceInput] transport:', error));
      },
      close
    };
  }
  const channel = new BroadcastChannel(VOICE_INPUT_CHANNEL);
  channel.onmessage = ({ data }) => receive(data);
  return {
    send: (message: VoiceCommand | VoiceEvent) => channel.postMessage(message),
    close: () => channel.close()
  };
}

export async function ensureVoiceHost() {
  if (isTauriDesktop()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('ensure_voice_host');
  } else if (!document.querySelector('[data-voice-host]')) {
    // Web Locks elect one owner across pages; each page keeps a standby host for navigation.
    const frame = document.createElement('iframe');
    frame.dataset.voiceHost = '';
    frame.src = '/pages/voice.html';
    frame.hidden = true;
    frame.allow = 'microphone';
    document.body.append(frame);
  }
}
