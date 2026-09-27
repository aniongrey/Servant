export const MEETING_USER_NAME_KEY = 'codex-list.meeting-user-name.v1';
export const DEFAULT_MEETING_USER_NAME = 'Master';

export function loadMeetingUserName(): string {
  if (typeof localStorage === 'undefined') return DEFAULT_MEETING_USER_NAME;
  return localStorage.getItem(MEETING_USER_NAME_KEY)?.trim().slice(0, 40) || DEFAULT_MEETING_USER_NAME;
}

export function saveMeetingUserName(value: string): void {
  const name = value.trim().slice(0, 40);
  localStorage.setItem(MEETING_USER_NAME_KEY, name);
}
