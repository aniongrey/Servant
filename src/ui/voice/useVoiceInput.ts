import { useEffect, useRef, useState } from 'react';
import { isTauriDesktop } from '../../desktop/tauri/navigation';
import { ensureVoiceHost, voiceInputTransport } from '../../ai/voice/voiceInputTransport';
import {
  emptyVoiceState,
  isVoiceEvent,
  sameVoiceTarget,
  type VoiceCommand,
  type VoiceTarget
} from '../../ai/voice/VoiceInputProtocol';
import type { SpeechPipelineTimings } from '../../ai/stt/speechRecognitionTypes';
import {
  loadVoiceSettings,
  saveVoiceSettings,
  VOICE_SETTINGS_CHANGED_EVENT,
  VOICE_SETTINGS_STORAGE_KEY,
  type VoiceSettings
} from '../../ai/voice/VoiceSettings';
import { readVoiceDraft, voiceDraftKey, writeVoiceDraft } from '../../ai/voice/voiceDraft';

async function requestMicrophonePermission() {
  const granted = await navigator.permissions
    .query({ name: 'microphone' as PermissionName })
    .then((value) => value.state === 'granted')
    .catch(() => false);
  if (granted) return;
  const deviceId = loadVoiceSettings().inputDeviceId;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { deviceId: { exact: deviceId } } : true
  });
  stream.getTracks().forEach((track) => track.stop());
}

interface Options {
  target: VoiceTarget | null;
  input: string;
  setInput(text: string): void;
  send(text: string): Promise<boolean>;
  interrupt(): void | Promise<void>;
  maxLength?: number;
  onTimings?(timings: SpeechPipelineTimings): void;
}

/** Page adapter: no microphone, model, or provider is constructed here. */
export function useVoiceInput(options: Options) {
  const [id] = useState(() => crypto.randomUUID());
  const [state, setState] = useState(emptyVoiceState);
  const [settings, setSettings] = useState(loadVoiceSettings);
  const [notice, setNotice] = useState('');
  const current = useRef(options);
  current.current = options;
  const transport = useRef<Awaited<ReturnType<typeof voiceInputTransport>> | null>(null);
  const focused = useRef(false);
  const lastHost = useRef(0);
  const activationEpoch = useRef(0);
  const draftRoute = useRef<{ key: string; text: string } | null>(null);
  const key = options.target
    ? JSON.stringify([options.target.page, options.target.sessionId, options.target.characterId])
    : '';
  const announce = () =>
    transport.current?.send({
      type: 'endpoint',
      endpoint: { id, target: current.current.target, focused: focused.current, updatedAt: Date.now() }
    });
  const command = (type: 'press' | 'release' | 'stop' | 'retry') => {
    announce();
    transport.current?.send({ type, id });
  };

  useEffect(() => {
    const target = current.current.target;
    try {
      if (target) {
        const nextKey = voiceDraftKey(target);
        if (draftRoute.current?.key !== nextKey) {
          const initial = draftRoute.current === null ? current.current.input : '';
          if (draftRoute.current) writeVoiceDraft(draftRoute.current.key, draftRoute.current.text);
          const text = readVoiceDraft(nextKey).text || initial;
          draftRoute.current = { key: nextKey, text };
          current.current.input = text;
          current.current.setInput(text);
        } else {
          draftRoute.current.text = options.input;
          writeVoiceDraft(nextKey, options.input);
        }
      }
    } catch {
      setNotice('草稿无法保存到本机，请保留页面并复制文字。');
    }
    announce();
  }, [key, options.input]);

  useEffect(() => {
    let disposed = false;
    let focusCleanup: (() => void) | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const error = (cause: unknown) => {
      if (!disposed) setNotice(String(cause));
    };
    const receive = async (value: unknown) => {
      if (!isVoiceEvent(value)) return;
      const event = value;
      if (event.type === 'stopped') {
        activationEpoch.current++;
        return;
      }
      if (event.type === 'state') {
        lastHost.current = Date.now();
        setState(event.state);
        return;
      }
      if (
        event.type === 'interrupt' &&
        event.id === id &&
        sameVoiceTarget(current.current.target, event.target)
      ) {
        await current.current.interrupt();
        return;
      }
      if (event.type !== 'result' || event.result.endpointId !== id) return;
      const result = event.result;
      if (result.timings) current.current.onTimings?.(result.timings);
      if (!sameVoiceTarget(current.current.target, result.target)) return;
      const ack = () => transport.current?.send({ type: 'ack', id, resultId: result.id });
      const storageKey = voiceDraftKey(result.target);
      if (readVoiceDraft(storageKey).received.includes(result.id)) {
        ack();
        return;
      }
      const before = current.current.input;
      const text = [before.trimEnd(), result.text.trim()].filter(Boolean).join(' ');
      if (text.length > (current.current.maxLength ?? 4000)) {
        setNotice('语音超过输入框长度限制，已保留在待处理语音中。');
        return;
      }
      writeVoiceDraft(storageKey, text, result.id);
      draftRoute.current = { key: storageKey, text };
      current.current.input = text;
      current.current.setInput(text);
      ack();
      if (!result.autoSend || !loadVoiceSettings().autoSend || before.trim()) {
        setNotice(
          before.trim() && result.autoSend ? '已有草稿，语音已追加，请确认后发送。' : '语音已填入输入框。'
        );
        return;
      }
      try {
        const sent = await current.current.send(text);
        if (!sent) {
          setNotice('暂时无法发送，语音已保留为草稿。');
          return;
        }
        if (readVoiceDraft(storageKey).text === text) writeVoiceDraft(storageKey, '');
        if (sameVoiceTarget(current.current.target, result.target) && current.current.input === text) {
          current.current.input = '';
          current.current.setInput('');
        }
        setNotice('语音已发送。');
      } catch (cause) {
        setNotice(`发送失败，草稿已保留：${String(cause)}`);
      }
    };
    void voiceInputTransport(false, (value) => {
      void receive(value).catch(error);
    })
      .then(async (connection) => {
        if (disposed) {
          connection.close();
          return;
        }
        transport.current = connection;
        if (isTauriDesktop()) {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          const win = getCurrentWindow();
          focused.current = await win.isFocused();
          const cleanup = await win.onFocusChanged(({ payload }) => {
            focused.current = payload;
            announce();
          });
          if (disposed) cleanup();
          else focusCleanup = cleanup;
        } else focused.current = document.hasFocus() && document.visibilityState === 'visible';
        if (disposed) return;
        announce();
        if (focused.current && loadVoiceSettings().inputMode !== 'muted') {
          await requestMicrophonePermission().catch(error);
        }
        if (disposed) return;
        await ensureVoiceHost();
        if (disposed) return;
        timer = setInterval(() => {
          announce();
          if (lastHost.current && Date.now() - lastHost.current > 6000) {
            setState((value) => ({
              ...value,
              ready: false,
              phase: 'idle',
              error: '语音宿主未响应，请重新打开对话页面。'
            }));
          }
        }, 1000);
      })
      .catch(error);
    const browserFocus = () => {
      if (isTauriDesktop()) return;
      focused.current = document.hasFocus() && document.visibilityState === 'visible';
      announce();
    };
    const keydown = (event: KeyboardEvent) => {
      if (
        event.code !== loadVoiceSettings().pushToTalkCode ||
        event.repeat ||
        loadVoiceSettings().inputMode === 'muted'
      )
        return;
      command('press');
      event.preventDefault();
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code !== loadVoiceSettings().pushToTalkCode) return;
      command('release');
    };
    const blur = () => {
      browserFocus();
      if (!isTauriDesktop()) command('release');
    };
    const reload = () => setSettings(loadVoiceSettings());
    const storage = (event: StorageEvent) => {
      if (event.key === VOICE_SETTINGS_STORAGE_KEY) reload();
    };
    window.addEventListener('focus', browserFocus);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', browserFocus);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('storage', storage);
    window.addEventListener(VOICE_SETTINGS_CHANGED_EVENT, reload);
    const leave = () => transport.current?.send({ type: 'leave', id });
    window.addEventListener('pagehide', leave);
    return () => {
      disposed = true;
      activationEpoch.current++;
      leave();
      clearInterval(timer);
      focusCleanup?.();
      transport.current?.close();
      transport.current = null;
      window.removeEventListener('focus', browserFocus);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', browserFocus);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('storage', storage);
      window.removeEventListener(VOICE_SETTINGS_CHANGED_EVENT, reload);
      window.removeEventListener('pagehide', leave);
    };
  }, [id]);

  const stop = () => {
    activationEpoch.current++;
    command('stop');
  };
  const update = (patch: Partial<VoiceSettings>) => {
    if (patch.inputMode === 'muted') stop();
    saveVoiceSettings({ ...loadVoiceSettings(), ...patch });
  };
  const activate = async () => {
    const epoch = ++activationEpoch.current;
    try {
      if (loadVoiceSettings().inputMode === 'muted') return false;
      await requestMicrophonePermission();
      if (epoch !== activationEpoch.current || loadVoiceSettings().inputMode === 'muted') return false;
      command('retry');
      return true;
    } catch (cause) {
      setNotice(`麦克风授权失败：${String(cause)}`);
      return false;
    }
  };
  return {
    state,
    settings,
    notice,
    target: options.target,
    press: () => command('press'),
    release: () => command('release'),
    stop,
    update,
    activate,
    recover: (resultId: string) =>
      transport.current?.send({ type: 'recover', id, resultId } satisfies VoiceCommand)
  };
}

export type VoiceInputClient = ReturnType<typeof useVoiceInput>;
