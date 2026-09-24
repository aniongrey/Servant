export type VoiceInputMode = 'push-to-talk' | 'muted' | 'realtime';

export interface VoiceSettings {
  inputMode: VoiceInputMode;
  inputDeviceId: string;
  outputDeviceId: string;
  pushToTalkCode: string;
}

export const VOICE_SETTINGS_STORAGE_KEY = 'codex-list.voiceSettings.v1';
export const VOICE_SETTINGS_CHANGED_EVENT = 'codex-list:voice-settings-changed';

export const defaultVoiceSettings: VoiceSettings = {
  inputMode: 'push-to-talk',
  inputDeviceId: '',
  outputDeviceId: '',
  pushToTalkCode: 'Backquote'
};

export function loadVoiceSettings(): VoiceSettings {
  if (typeof localStorage === 'undefined') return defaultVoiceSettings;
  try {
    return normalizeVoiceSettings(JSON.parse(localStorage.getItem(VOICE_SETTINGS_STORAGE_KEY) ?? 'null'));
  } catch {
    return defaultVoiceSettings;
  }
}

export function saveVoiceSettings(settings: VoiceSettings): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(VOICE_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeVoiceSettings(settings)));
  window.dispatchEvent(new Event(VOICE_SETTINGS_CHANGED_EVENT));
}

export function normalizeVoiceSettings(value: Partial<VoiceSettings> | null | undefined): VoiceSettings {
  return {
    inputMode:
      value?.inputMode === 'muted' || value?.inputMode === 'realtime' ? value.inputMode : 'push-to-talk',
    inputDeviceId: typeof value?.inputDeviceId === 'string' ? value.inputDeviceId : '',
    outputDeviceId: typeof value?.outputDeviceId === 'string' ? value.outputDeviceId : '',
    pushToTalkCode:
      typeof value?.pushToTalkCode === 'string' && value.pushToTalkCode ? value.pushToTalkCode : 'Backquote'
  };
}

export function formatShortcut(code: string): string {
  if (code === 'Backquote') return '`';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code.replace(/(Left|Right)$/, '');
}
