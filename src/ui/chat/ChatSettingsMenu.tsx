import { Mic, RefreshCw, Settings2, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  formatShortcut,
  loadVoiceSettings,
  saveVoiceSettings,
  VOICE_SETTINGS_CHANGED_EVENT,
  type VoiceInputMode,
  type VoiceSettings
} from '../../ai/voice/VoiceSettings';
import {
  CHAT_CONTEXT_SETTINGS_CHANGED_EVENT,
  loadChatContextMessageLimit,
  MAX_CONTEXT_MESSAGE_LIMIT,
  MIN_CONTEXT_MESSAGE_LIMIT,
  saveChatContextMessageLimit
} from './chatContextSettings';

/**
 * The chat window's gear menu — the single place for chat-scoped preferences.
 * The popover shell (open state, outside click, Escape) is shared, so a new
 * setting is one more field here rather than another button in the header.
 */
export function ChatSettingsMenu() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [capturingShortcut, setCapturingShortcut] = useState(false);
  const [settings, setSettings] = useState(loadVoiceSettings);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState('');
  const [contextLimit, setContextLimit] = useState(loadChatContextMessageLimit);
  // The text in the box, which is allowed to be transiently invalid ("1" on the
  // way to "14"); only in-range values are persisted while typing and blur
  // settles whatever is left.
  const [contextLimitDraft, setContextLimitDraft] = useState(() =>
    String(loadChatContextMessageLimit())
  );

  const update = (patch: Partial<VoiceSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveVoiceSettings(next);
  };

  const refreshDevices = async (requestPermission = false) => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    let stream: MediaStream | undefined;
    try {
      if (requestPermission) stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setDevices(
        (await navigator.mediaDevices.enumerateDevices()).filter(
          (device) => device.kind === 'audioinput' || device.kind === 'audiooutput'
        )
      );
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取音频设备。');
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  };

  useEffect(() => {
    const reload = () => setSettings(loadVoiceSettings());
    window.addEventListener(VOICE_SETTINGS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(VOICE_SETTINGS_CHANGED_EVENT, reload);
  }, []);

  useEffect(() => {
    const reload = () => {
      const next = loadChatContextMessageLimit();
      setContextLimit(next);
      setContextLimitDraft(String(next));
    };
    window.addEventListener(CHAT_CONTEXT_SETTINGS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(CHAT_CONTEXT_SETTINGS_CHANGED_EVENT, reload);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const updateContextLimit = (raw: string) => {
    setContextLimitDraft(raw);
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < MIN_CONTEXT_MESSAGE_LIMIT || parsed > MAX_CONTEXT_MESSAGE_LIMIT)
      return;
    setContextLimit(saveChatContextMessageLimit(parsed));
  };

  const settleContextLimit = () => {
    const parsed = Number.parseInt(contextLimitDraft, 10);
    const saved = saveChatContextMessageLimit(Number.isFinite(parsed) ? parsed : contextLimit);
    setContextLimit(saved);
    setContextLimitDraft(String(saved));
  };

  return (
    <div className="wechatSettings" ref={rootRef} onPointerDown={(event) => event.stopPropagation()}>
      <button
        aria-controls="chat-settings-menu"
        aria-expanded={open}
        className="wechatIconButton"
        onClick={() => {
          setOpen((current) => !current);
          if (!open) void refreshDevices();
        }}
        title="聊天设置"
        type="button"
      >
        <Settings2 size={16} />
      </button>
      {open ? (
        <div className="wechatSettingsMenu" id="chat-settings-menu" role="dialog" aria-label="聊天设置">
          <strong>聊天设置</strong>
          <label>
            <span>上下文条数</span>
            <input
              aria-describedby="chat-context-limit-hint"
              inputMode="numeric"
              max={MAX_CONTEXT_MESSAGE_LIMIT}
              min={MIN_CONTEXT_MESSAGE_LIMIT}
              onBlur={settleContextLimit}
              onChange={(event) => updateContextLimit(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                settleContextLimit();
              }}
              type="number"
              value={contextLimitDraft}
            />
          </label>
          <p className="wechatSettingsHint" id="chat-context-limit-hint">
            每轮对话带上多少条历史聊天（{MIN_CONTEXT_MESSAGE_LIMIT}–{MAX_CONTEXT_MESSAGE_LIMIT}）。只影响模型看到的对话上下文，长期记忆不受影响。
          </p>
          <strong className="wechatSettingsGroup">输入与输出</strong>
          <label>
            <span>说话模式</span>
            <select
              value={settings.inputMode}
              onChange={(event) => update({ inputMode: event.currentTarget.value as VoiceInputMode })}
            >
              <option value="push-to-talk">按键说话</option>
              <option value="muted">闭麦</option>
              <option value="realtime">实时语音</option>
            </select>
          </label>
          <label>
            <span><Mic size={13} /> 输入麦克风</span>
            <select
              value={settings.inputDeviceId}
              onChange={(event) => update({ inputDeviceId: event.currentTarget.value })}
            >
              <option value="">系统默认</option>
              {devices
                .filter((device) => device.kind === 'audioinput')
                .map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `麦克风 ${index + 1}`}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span><Volume2 size={13} /> 输出音频设备</span>
            <select
              value={settings.outputDeviceId}
              onChange={(event) => update({ outputDeviceId: event.currentTarget.value })}
            >
              <option value="">系统默认</option>
              {devices
                .filter((device) => device.kind === 'audiooutput')
                .map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `扬声器 ${index + 1}`}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>按键说话键位</span>
            <input
              readOnly
              value={capturingShortcut ? '请按下按键…' : formatShortcut(settings.pushToTalkCode)}
              onFocus={() => setCapturingShortcut(true)}
              onBlur={() => setCapturingShortcut(false)}
              onKeyDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
                update({ pushToTalkCode: event.code });
                setCapturingShortcut(false);
                event.currentTarget.blur();
              }}
            />
          </label>
          <button className="wechatAudioRefresh" onClick={() => void refreshDevices(true)} type="button">
            <RefreshCw size={13} /> 刷新设备
          </button>
          {error ? <small role="alert">{error}</small> : null}
        </div>
      ) : null}
    </div>
  );
}
