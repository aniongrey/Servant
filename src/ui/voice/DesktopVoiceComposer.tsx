import { useState } from 'react';
import type { CharacterProfile } from '../../character/characterProfiles';
import type { MeetingSession } from '../meeting/meetingState';
import { sendStageMeetingCommand } from '../meeting/stageMeetingBridge';
import { useVoiceInput } from './useVoiceInput';
import { VoiceSendComposer } from './VoiceSendComposer';
import { VoiceRecipients } from './VoiceRecipients';

export function DesktopVoiceComposer({
  meeting,
  profiles,
  speaker,
  setSpeaker,
  settingsOpen,
  onSettingsChange
}: {
  meeting: MeetingSession;
  profiles: CharacterProfile[];
  speaker: string;
  setSpeaker(id: string): void;
  settingsOpen: boolean;
  onSettingsChange(open: boolean): void;
}) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const send = async (text: string) => {
    if (pending || !text.trim() || meeting.status !== 'active') return false;
    setPending(true);
    setError('');
    try {
      await sendStageMeetingCommand({ type: 'send', sessionId: meeting.id, speakerId: speaker, text });
      setInput((current) => (current === text ? '' : current));
      return true;
    } catch (cause) {
      setError(String(cause));
      return false;
    } finally {
      setPending(false);
    }
  };
  const interrupt = () => sendStageMeetingCommand({ type: 'interrupt', sessionId: meeting.id });
  const voice = useVoiceInput({
    target:
      meeting.status === 'active' && meeting.participants.includes(speaker)
        ? {
            page: 'desktop',
            sessionId: meeting.id,
            characterId: speaker,
            label:
              'Galgame · ' +
              meeting.title +
              ' · ' +
              (profiles.find((item) => item.id === speaker)?.name ?? '角色')
          }
        : null,
    input,
    setInput,
    send,
    interrupt
  });
  return (
    <>
      <VoiceSendComposer
        voice={voice}
        input={input}
        setInput={setInput}
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
        disabled={pending || meeting.status !== 'active'}
        placeholder="说点什么…"
        interrupt={() => void interrupt().catch((cause) => setError(String(cause)))}
        settingsOpen={settingsOpen}
        onSettingsChange={onSettingsChange}
        showSettingsButton={false}
        recipients={
          <VoiceRecipients
            profiles={meeting.participants
              .map((id) => profiles.find((profile) => profile.id === id))
              .filter((profile): profile is CharacterProfile => Boolean(profile))}
            selectedId={speaker}
            onSelect={setSpeaker}
          />
        }
      />
      {error && <p role="alert">{error}</p>}
    </>
  );
}
