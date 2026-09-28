import { useEffect, useState } from 'react';
import { CHARACTER_PROFILES_KEY, loadCharacterProfiles } from '../../character/characterProfiles';
import { loadMeetingDesktopCast, loadMeetings, MEETINGS_KEY, MEETING_DESKTOP_CAST_KEY } from '../meeting/meetingState';

function snapshot() {
  const id = loadMeetingDesktopCast();
  const meetings = loadMeetings().filter((item) => item.status !== 'ended');
  return { meeting: meetings.find((item) => item.id === id) ?? null, meetings, profiles: loadCharacterProfiles() };
}
export function useStageMeeting() {
  const [value, setValue] = useState(snapshot);
  useEffect(() => {
    const refresh = () => setValue(snapshot());
    const storage = (event: StorageEvent) => { if (!event.key || [MEETINGS_KEY, MEETING_DESKTOP_CAST_KEY, CHARACTER_PROFILES_KEY].includes(event.key)) refresh(); };
    window.addEventListener('storage', storage);
    window.addEventListener('servant:meetings-changed', refresh);
    window.addEventListener('servant:meeting-desktop-cast-changed', refresh);
    window.addEventListener('servant:character-profiles-changed', refresh);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener('servant:meetings-changed', refresh);
      window.removeEventListener('servant:meeting-desktop-cast-changed', refresh);
      window.removeEventListener('servant:character-profiles-changed', refresh);
    };
  }, []);
  return value;
}
