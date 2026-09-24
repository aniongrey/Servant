import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, MessageCircle, Power, RotateCcw, Settings2, Sparkles } from 'lucide-react';
import {
  isTauriDesktop,
  openChatWindow,
  openSettingsHome
} from '../desktop/tauri/navigation';

const menuItems = [
  { id: 'chat', title: '对话', icon: MessageCircle },
  { id: 'settings', title: '设置', icon: Settings2 },
  { id: 'restart', title: '重启', icon: RotateCcw },
  { id: 'quit', title: '退出', icon: Power }
] as const;
type MenuAction = 'toggle-pet' | (typeof menuItems)[number]['id'];

export async function runDesktopMenuAction(label: MenuAction) {
  if (isTauriDesktop()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('run_desktop_menu_action', { label });
  } else {
    const action = { chat: openChatWindow, settings: openSettingsHome };
    if (label in action) await action[label as keyof typeof action]();
  }
}

export function DesktopMenuPanel({
  onSelect,
  petVisible = true
}: {
  onSelect: (label: MenuAction) => void;
  petVisible?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, []);
  return (
    <div
      className="companion-menu"
      role="menu"
      aria-label="Shiro 角色菜单"
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
        <strong>Shiro</strong>
        <span>COMPANION</span>
      </div>
      <button
        type="button"
        role="menuitem"
        disabled={!isTauriDesktop()}
        onClick={() => onSelect('toggle-pet')}
      >
        {petVisible ? <EyeOff size={16} /> : <Eye size={16} />}
        <span>{petVisible ? '隐藏角色' : '显示角色'}</span>
      </button>
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
  const [petVisible, setPetVisible] = useState(true);
  useEffect(() => {
    if (!isTauriDesktop()) return;
    const refresh = () => {
      void import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke<boolean>('get_desktop_pet_visible'))
        .then(setPetVisible)
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
        petVisible={petVisible}
        onSelect={(label) => {
          if (label === 'toggle-pet') setPetVisible((visible) => !visible);
          void runDesktopMenuAction(label).catch((cause) => setError(String(cause)));
        }}
      />
      {error ? <small role="alert">{error}</small> : null}
    </main>
  );
}
