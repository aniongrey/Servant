import '../ui/fonts.css';
import { SherpaSpeechRecognition } from '../ai/stt/SherpaSpeechRecognition';
import { VoiceInputRuntime } from '../ai/voice/VoiceInputRuntime';
import { isVoiceCommand, isVoiceResult, VOICE_INBOX_KEY } from '../ai/voice/VoiceInputProtocol';
import { voiceInputTransport } from '../ai/voice/voiceInputTransport';
import {
  loadVoiceSettings,
  saveVoiceSettings,
  VOICE_SETTINGS_STORAGE_KEY,
  VOICE_SETTINGS_CHANGED_EVENT
} from '../ai/voice/VoiceSettings';
import { RealtimeGatewayClient } from './network/realtime/RealtimeGatewayClient';
import { ACTION_VOICE_TOPIC, parseVoiceStreamEvent } from './network/realtime/VoiceStreamProtocol';
import { ensureApiBase } from './network/apiBase';
import { isTauriDesktop } from '../desktop/tauri/navigation';

async function run() {
  await ensureApiBase();
  let lastInbox = '';
  const transport = await voiceInputTransport(true, (value) => {
    if (!isVoiceCommand(value)) return;
    if (value.type === 'endpoint') runtime.register(value.endpoint);
    else if (value.type === 'leave') runtime.leave(value.id);
    else if (value.type === 'press') {
      if (runtime.endpoints.has(value.id)) runtime.press();
    } else if (value.type === 'release') runtime.release();
    else if (value.type === 'stop') runtime.stop();
    else if (value.type === 'retry') {
      runtime.configure(loadVoiceSettings());
      void runtime.activate();
    } else if (value.type === 'ack') runtime.ack(value.id, value.resultId);
    else if (value.type === 'recover') runtime.recover(value.id, value.resultId);
  });
  const runtime = new VoiceInputRuntime(new SherpaSpeechRecognition(), loadVoiceSettings(), (event) => {
    if (event.type === 'state') {
      const inbox = JSON.stringify(event.state.pending);
      if (inbox !== lastInbox) {
        try {
          localStorage.setItem(VOICE_INBOX_KEY, inbox);
          lastInbox = inbox;
        } catch {
          event.state.error = '待处理语音无法保存，请及时复制文字。';
        }
      }
      document.getElementById('status')!.textContent =
        event.state.error || `${event.state.phase} ${event.state.targetLabel}`;
    }
    transport.send(event);
  });
  try {
    const pending: unknown = JSON.parse(localStorage.getItem(VOICE_INBOX_KEY) ?? '[]');
    if (Array.isArray(pending))
      runtime.state.pending = pending.filter(isVoiceResult).map((item) => ({ ...item, autoSend: false }));
  } catch {
    /* An invalid inbox must not prevent capture startup. */
  }
  document.getElementById('stop')!.onclick = () => runtime.stop();
  const playback = new RealtimeGatewayClient();
  playback.on(ACTION_VOICE_TOPIC, (payload) => {
    const event = parseVoiceStreamEvent(payload);
    if (!event) return;
    const id = JSON.stringify([event.id, event.characterId]);
    if (event.type === 'speech-playback-started') runtime.playback(id, true);
    if (event.type === 'speech-playback-completed' || event.type === 'speech-cancel')
      runtime.playback(id, false);
  });
  playback.onStateChange((state) => {
    if (state === 'disconnected') runtime.playbackDisconnected();
  });
  playback.connect();

  let shortcut = '';
  let shortcutUpdate = Promise.resolve();
  const reload = () => {
    const settings = loadVoiceSettings();
    runtime.configure(settings);
    if (isTauriDesktop())
      shortcutUpdate = shortcutUpdate
        .then(async () => {
          const { invoke } = await import('@tauri-apps/api/core');
          const next = settings.inputMode === 'muted' ? '' : settings.pushToTalkCode;
          if (next === shortcut) return;
          if (shortcut) {
            await invoke('set_push_to_talk_shortcut', { enabled: false, shortcutCode: shortcut });
            shortcut = '';
          }
          if (next) {
            await invoke('set_push_to_talk_shortcut', { enabled: true, shortcutCode: next });
            shortcut = next;
          }
        })
        .catch((error) => {
          runtime.state.error = `全局快捷键注册失败：${String(error)}`;
          runtime.tick();
        });
  };
  window.addEventListener('storage', (event) => {
    if (event.key === VOICE_SETTINGS_STORAGE_KEY) reload();
  });
  window.addEventListener(VOICE_SETTINGS_CHANGED_EVENT, reload);
  if (isTauriDesktop()) {
    const { listen } = await import('@tauri-apps/api/event');
    await listen<string>('servant-global-ptt', ({ payload }) => {
      if (payload === 'pressed') runtime.press();
      else if (payload === 'released') runtime.release();
    });
  }
  reload();
  void runtime.activate();
  let lastTick = Date.now();
  let checkingSession = false;
  const suspend = () => {
    runtime.stop();
    const settings = loadVoiceSettings();
    if (settings.backgroundEnabled) saveVoiceSettings({ ...settings, backgroundEnabled: false });
    runtime.state.error = '系统暂停或锁屏后语音已停止，请切换语音模式恢复。';
  };
  const timer = setInterval(() => {
    const now = Date.now();
    if (now - lastTick > 8000) suspend();
    lastTick = now;
    runtime.tick();
    if (isTauriDesktop() && !checkingSession) {
      checkingSession = true;
      void import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke<boolean>('voice_session_available'))
        .then((available) => {
          if (!available) suspend();
        })
        .catch(() => suspend())
        .finally(() => {
          checkingSession = false;
        });
    }
  }, 1000);
  window.addEventListener(
    'pagehide',
    () => {
      clearInterval(timer);
      runtime.destroy();
      transport.close();
      playback.close();
    },
    { once: true }
  );
  await new Promise<void>(() => undefined);
}

// A browser can open more than one host URL; Web Locks still allow only one microphone owner.
void navigator.locks.request('servant.voice-host', {}, run).catch((error) => {
  document.getElementById('status')!.textContent = `语音宿主启动失败：${String(error)}`;
});
