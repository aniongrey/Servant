import { useState, type FormEvent, type ReactNode } from 'react';
import { Send } from 'lucide-react';
import { Button, TextInput } from '../shared/ServantControls';
import { VoiceInputControls, VoiceMicButton } from './VoiceInputControls';
import type { VoiceInputClient } from './useVoiceInput';

/** Shared send controls; Meeting and Galgame provide their own palette and recipient view. */
export function VoiceSendComposer({
  voice,
  recipients,
  input,
  setInput,
  onSubmit,
  disabled,
  placeholder,
  interrupt,
  settingsOpen,
  onSettingsChange,
  showSettingsButton = true
}: {
  voice: VoiceInputClient;
  recipients: ReactNode;
  input: string;
  setInput(value: string): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  disabled: boolean;
  placeholder: string;
  interrupt?: () => void;
  settingsOpen?: boolean;
  onSettingsChange?: (open: boolean) => void;
  showSettingsButton?: boolean;
}) {
  const [localSettingsOpen, setLocalSettingsOpen] = useState(false);
  return (
    <div className="voice-send-composer">
      {recipients}
      <form className="voice-send-form" onSubmit={onSubmit}>
        <VoiceMicButton voice={voice} />
        <TextInput
          aria-label="输入消息"
          placeholder={placeholder}
          value={input}
          maxLength={4000}
          disabled={disabled}
          onChange={(event) => setInput(event.currentTarget.value)}
        />
        <Button aria-label="发送" type="submit" variant="primary" disabled={!input.trim() || disabled}>
          <Send size={17} />
        </Button>
        {interrupt && (
          <Button type="button" onClick={interrupt}>
            打断
          </Button>
        )}
      </form>
      <VoiceInputControls
        voice={voice}
        settingsOpen={settingsOpen ?? localSettingsOpen}
        onSettingsChange={onSettingsChange ?? setLocalSettingsOpen}
        showSettingsButton={showSettingsButton}
      />
    </div>
  );
}
