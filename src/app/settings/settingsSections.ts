import {
  Activity,
  AudioLines,
  BookHeart,
  Bot,
  CircleUserRound,
  Gamepad2,
  LibraryBig,
  Radio,
  ScrollText,
  Settings2
} from 'lucide-react';

export type SettingsSectionId =
  | 'system'
  | 'character-settings'
  | 'character-panel'
  | 'memoir'
  | 'live'
  | 'actions'
  | 'games'
  | 'llm'
  | 'tts'
  | 'logs';

export interface SettingsSectionDefinition {
  id: SettingsSectionId;
  label: string;
  eyebrow: string;
  icon: typeof Settings2;
}

/**
 * The settings window's panels, in sidebar order. Anything that needs to name a
 * panel — the sidebar itself, a deep link from another window — reads this list,
 * so a new panel is added in one place.
 */
export const settingsSections: readonly SettingsSectionDefinition[] = [
  { id: 'system', label: '系统设置', eyebrow: 'System', icon: Settings2 },
  { id: 'character-settings', label: '角色设置', eyebrow: 'Character', icon: CircleUserRound },
  { id: 'character-panel', label: '角色面板', eyebrow: 'Companion', icon: Activity },
  { id: 'memoir', label: '回忆录', eyebrow: 'Memoir', icon: BookHeart },
  { id: 'live', label: '直播设置（未实现）', eyebrow: 'Live', icon: Radio },
  { id: 'actions', label: '动作库', eyebrow: 'Motion', icon: LibraryBig },
  { id: 'games', label: '游戏监听（未实现）', eyebrow: 'Game Watch', icon: Gamepad2 },
  { id: 'llm', label: 'LLM 设置', eyebrow: 'Intelligence', icon: Bot },
  { id: 'tts', label: '语音设置', eyebrow: 'Voice', icon: AudioLines },
  { id: 'logs', label: '日志', eyebrow: 'Logs', icon: ScrollText }
];

/**
 * Reads the `?section=` value out of a settings window URL.
 *
 * The setup wizard sends the user straight to the LLM panel, so the panel has to
 * survive a real navigation — it travels in the URL rather than as a message,
 * because an event can outrun the webview that is still booting. `voice` is kept
 * as an alias for links written before the panel was renamed to `tts`, and an
 * unknown value is ignored rather than guessed at: landing on the default panel
 * beats landing on the wrong one.
 */
export function resolveSettingsSection(value: string | null | undefined): SettingsSectionId | null {
  if (!value) return null;
  const wanted = value === 'voice' ? 'tts' : value;
  return settingsSections.find((section) => section.id === wanted)?.id ?? null;
}
