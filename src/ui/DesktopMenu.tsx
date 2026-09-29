import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, MessageCircle, Power, RotateCcw, Settings2, Sparkles, Users } from 'lucide-react';
import {
  isTauriDesktop,
  openChatWindow,
  openMeetingWindow,
  openSettingsHome
} from '../desktop/tauri/navigation';

const menuItems = [
  { id: 'chat', title: '对话', icon: MessageCircle },
  { id: 'meeting', title: '多人聊天', icon: Users },
  { id: 'settings', title: '设置', icon: Settings2 },
  { id: 'restart', title: '重启', icon: RotateCcw },
  { id: 'quit', title: '退出', icon: Power }
] as const;
type MenuAction = 'toggle-stage' | (typeof menuItems)[number]['id'];

/** 菜单窗口的内宽，与后端建窗时的宽度一致（`desktop_windows.rs`）。 */
const MENU_WIDTH = 240;

/**
 * 让菜单窗口贴住内容高度。
 *
 * 高度原先写死在 320，而菜单内容比它高（标题 + 7 项约 341px），于是最后一项「退出」
 * 被裁掉下半截。宽度固定、高度按量出来的内容报给后端，菜单项增删或系统字体变化都不会
 * 再裁；多出来的余量由 CSS 的底边对齐吸收（透明，朝上溢出视野之外）。
 */
export function fitMenuWindow(height: number): void {
  const rounded = Math.ceil(height);
  if (!Number.isFinite(rounded) || rounded <= 0) return;
  if (isTauriDesktop()) {
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('fit_desktop_menu', { height: rounded }))
      .catch((cause) => console.error('Unable to fit the character menu window', cause));
    return;
  }
  // 浏览器预览是个 popup：只有脚本打开的窗口才允许自己改尺寸，改不了就算了。
  try {
    if (window.opener) window.resizeTo(MENU_WIDTH, rounded);
  } catch {
    /* 浏览器拒绝改尺寸时保持原样 */
  }
}

export async function runDesktopMenuAction(label: MenuAction) {
  if (isTauriDesktop()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('run_desktop_menu_action', { label });
  } else {
    const action = { chat: openChatWindow, meeting: openMeetingWindow, settings: openSettingsHome };
    if (label in action) await action[label as keyof typeof action]();
  }
}

export function DesktopMenuPanel({
  onSelect,
  stageActive = false,
  stageVisible = false,
  onHeightChange
}: {
  onSelect: (label: MenuAction) => void;
  stageActive?: boolean;
  stageVisible?: boolean;
  /** 菜单自然高度；原生窗口按它调整自己（见 `fitMenuWindow`）。 */
  onHeightChange?: (height: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, []);
  useEffect(() => {
    const element = root.current;
    if (!element || !onHeightChange) return;
    const report = () => onHeightChange(element.getBoundingClientRect().height);
    report();
    // 字号/字体或菜单项一变高度就变，所以每次都重新量，而不是只在挂载时量一次。
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [onHeightChange]);
  return (
    <div
      className="companion-menu"
      role="menu"
      aria-label="Servant 桌面菜单"
      ref={root}
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
            ? buttons.length - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
    >
      <div className="companion-menu-heading">
        <Sparkles size={14} />
        <strong>Servant</strong>
        <span>COMPANION</span>
      </div>
      {stageActive && <button
        type="button"
        role="menuitem"
        disabled={!isTauriDesktop()}
        onClick={() => onSelect('toggle-stage')}
      >
        {stageVisible ? <EyeOff size={16} /> : <Eye size={16} />}
        <span>{stageVisible ? '隐藏舞台' : '显示舞台'}</span>
      </button>}
      {menuItems.map(({ id, title, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="menuitem"
            data-danger={id === 'quit'}
            disabled={!isTauriDesktop() && (id === 'restart' || id === 'quit')}
            onClick={() => onSelect(id)}
          >
            <Icon size={16} />
            <span>{title}</span>
          </button>
        ))}
    </div>
  );
}

export function DesktopMenuPage() {
  const [error, setError] = useState('');
  const [stage, setStage] = useState({ active: false, visible: false });
  useEffect(() => {
    if (!isTauriDesktop()) return;
    const refresh = () => {
      void import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke<[boolean, boolean]>('get_desktop_stage_status'))
        .then(([active, visible]) => setStage({ active, visible }))
        .catch((cause) => setError(String(cause)));
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isTauriDesktop())
        void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().hide());
      else window.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <main className="desktop-menu-page">
      <DesktopMenuPanel
        stageActive={stage.active}
        stageVisible={stage.visible}
        onHeightChange={fitMenuWindow}
        onSelect={(label) => {
          void runDesktopMenuAction(label).catch((cause) => setError(String(cause)));
        }}
      />
      {error ? <small role="alert">{error}</small> : null}
    </main>
  );
}
