import { avatarFor, type CharacterProfile } from '../../character/characterProfiles';
import { avatarImageSource } from '../../app/network/avatarImageClient';
import type { ReactNode } from 'react';

export function VoiceRecipients({
  profiles,
  selectedId,
  onSelect,
  status
}: {
  profiles: CharacterProfile[];
  selectedId: string;
  onSelect(id: string): void;
  status?: ReactNode;
}) {
  return (
    <div className="voice-recipients" aria-label="对谁说话">
      <span>对谁说话</span>
      {profiles.map((profile) => (
        <button
          key={profile.id}
          type="button"
          data-selected={profile.id === selectedId}
          aria-pressed={profile.id === selectedId}
          onClick={() => onSelect(profile.id)}
        >
          <img src={avatarImageSource(profile.avatarId, avatarFor(profile.avatarId).image)} alt="" />
          <span>
            {profile.name}
            {profile.id === selectedId && status}
          </span>
        </button>
      ))}
    </div>
  );
}
