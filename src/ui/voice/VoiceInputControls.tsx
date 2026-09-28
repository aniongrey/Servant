import { Mic, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { Button, TextInput } from '../shared/ServantControls';
import { formatShortcut } from '../../ai/voice/VoiceSettings';
import type { VoiceInputClient } from './useVoiceInput';
import './voice-input.css';

export function VoiceMicButton({ voice }: { voice: VoiceInputClient }) {
  const recording = voice.state.phase === 'recording';
  return (
    <Button
      type="button"
      className="voice-mic-button"
      aria-label="按住语音转文字"
      title={`按住说话 · ${formatShortcut(voice.settings.pushToTalkCode)}`}
      aria-pressed={recording}
      disabled={
        !voice.target || !voice.state.ready || !voice.state.enabled || voice.settings.inputMode === 'muted'
      }
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        voice.press();
      }}
      onPointerUp={voice.release}
      onPointerCancel={voice.release}
      onLostPointerCapture={voice.release}
      onKeyDown={(event) => {
        if ([' ', 'Enter'].includes(event.key) && !event.repeat) {
          event.preventDefault();
          voice.press();
        }
      }}
      onKeyUp={(event) => {
        if ([' ', 'Enter'].includes(event.key)) {
          event.preventDefault();
          voice.release();
        }
      }}
      onBlur={voice.release}
    >
      <Mic size={17} />
    </Button>
  );
}

export function VoiceInputControls({
  voice,
  settingsOpen,
  onSettingsChange,
  showSettingsButton = false
}: {
  voice: VoiceInputClient;
  settingsOpen?: boolean;
  onSettingsChange?(open: boolean): void;
  showSettingsButton?: boolean;
}) {
  const { state, settings } = voice;
  const [localOpen, setLocalOpen] = useState(false);
  const open = settingsOpen ?? localOpen;
  const setOpen = onSettingsChange ?? setLocalOpen;
  const problem = state.error || (/失败|无法|错误|超时/.test(voice.notice) ? voice.notice : '');
  const mode = (realtime: boolean) => {
    voice.update({ inputMode: realtime ? 'realtime' : 'push-to-talk' });
    if (realtime) void voice.activate();
  };
  return (
    <div className="voice-input-controls" aria-label="语音输入">
      <div className="voice-input-options">
        <label>
          <input
            type="checkbox"
            checked={settings.inputMode === 'realtime'}
            onChange={(event) => mode(event.target.checked)}
          />
          自由麦
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.autoSend}
            onChange={(event) => voice.update({ autoSend: event.target.checked })}
          />
          自动发送
        </label>
        {showSettingsButton && (
          <Button
            type="button"
            className="voice-settings-button"
            aria-label="语音设置"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Settings2 size={16} />
          </Button>
        )}
      </div>
      {problem && <small role="alert">{problem}</small>}
      {open && (
        <div className="voice-input-settings">
          <label>
            <input
              type="checkbox"
              checked={settings.muteWhileSpeaking}
              onChange={(event) => voice.update({ muteWhileSpeaking: event.target.checked })}
            />
            角色说话时闭麦
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.interruptOnSpeech}
              onChange={(event) => voice.update({ interruptOnSpeech: event.target.checked })}
            />
            语音输入打断
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.backgroundEnabled}
              onChange={(event) => voice.update({ backgroundEnabled: event.target.checked })}
            />
            后台语音
          </label>
          <label>
            按键快捷键
            <TextInput
              aria-label="语音快捷键"
              readOnly
              value={formatShortcut(settings.pushToTalkCode)}
              onFocus={voice.stop}
              onBlur={() => void voice.activate()}
              onKeyDown={(event) => {
                if (event.key === 'Tab') return;
                event.preventDefault();
                event.stopPropagation();
                if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
                voice.update({ pushToTalkCode: event.code });
                event.currentTarget.blur();
              }}
            />
          </label>
          {state.pending.length > 0 && (
            <div>
              <strong>待处理语音（{state.pending.length}）</strong>
              {state.pending.map((item) => (
                <div key={item.id}>
                  <span>
                    {item.target.label}：{item.text}
                  </span>
                  <Button type="button" onClick={() => voice.recover(item.id)}>
                    填入当前草稿
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
