import { type UiPreferences, loadUiPreferences } from '../app/settings/uiPreferences';
import { UI_THEME_CHANGED_EVENT } from '../app/settings/useUiTheme';
import {
  GLOBAL_PROXY_ENABLED_STORAGE_KEY,
  GLOBAL_PROXY_URL_STORAGE_KEY,
  WEB_SEARCH_ENABLED_STORAGE_KEY,
  UI_PREFERENCES_STORAGE_KEY
} from '../app/settings/storageKeys';
import {
  resolveSettingsSection,
  settingsSections,
  type SettingsSectionId
} from '../app/settings/settingsSections';
import './user-interface.css';
import { Sparkles, ChevronRight, ShieldCheck, Minus, Maximize2, X } from 'lucide-react';
import { useState, useEffect, type Dispatch, type SetStateAction } from 'react';

import { loadWebSearchEnabled } from '../app/network/webSearchSettings';
import { SystemSettings, type AutoStartStatus } from './settings/SystemSettings';
import { CharacterSettings } from './settings/CharacterSettings';
import { CharacterStatePanel } from './settings/CharacterStatePanel';
import { MemoirSettings } from './settings/MemoirSettings';
import { LiveSettings } from './settings/LiveSettings';
import { ActionSettings } from './settings/ActionSettings';
import { GameSettings } from './settings/GameSettings';
import { LlmSettings } from './settings/LlmSettings';
import { TtsSettings } from './settings/TtsSettings';
import { LogsPanel } from './settings/LogsPanel';
import {
  isTauriDesktop,
  startDesktopWindowDrag,
  minimizeCurrentDesktopWindow,
  toggleMaximizeCurrentDesktopWindow,
  closeCurrentDesktopWindow
} from '../desktop/tauri/navigation';
import { useDesktopAutoStart } from '../desktop/tauri/useDesktopAutoStart';

export function UserInterfaceApp() {
  // A panel can be requested by URL (`?section=llm`); the sidebar takes over from
  // there, so the query is read once on mount and never rewritten.
  const [section, setSection] = useState<SettingsSectionId>(
    () => resolveSettingsSection(new URLSearchParams(window.location.search).get('section')) ?? 'system'
  );
  const [preferences, setPreferences] = useState<UiPreferences>(loadUiPreferences);
  const current = settingsSections.find((item) => item.id === section) ?? settingsSections[0];
  const autoStart = useDesktopAutoStart(preferences.autoStart, (enabled) =>
    setPreferences((previous) =>
      previous.autoStart === enabled ? previous : { ...previous, autoStart: enabled }
    )
  );

  useEffect(() => {
    localStorage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    window.dispatchEvent(new Event(UI_THEME_CHANGED_EVENT));
    localStorage.setItem(GLOBAL_PROXY_ENABLED_STORAGE_KEY, JSON.stringify(preferences.proxyEnabled));
    localStorage.setItem(GLOBAL_PROXY_URL_STORAGE_KEY, preferences.proxyUrl);
    localStorage.setItem(WEB_SEARCH_ENABLED_STORAGE_KEY, JSON.stringify(preferences.webSearchEnabled));
  }, [preferences]);

  useEffect(() => {
    void loadWebSearchEnabled(preferences.webSearchEnabled).then((enabled) => {
      setPreferences((current) =>
        current.webSearchEnabled === enabled ? current : { ...current, webSearchEnabled: enabled }
      );
    });
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const previousFontSize = root.style.fontSize;
    root.style.fontSize = `${16 * preferences.fontScale}px`;
    return () => {
      root.style.fontSize = previousFontSize;
    };
  }, [preferences.fontScale]);

  return (
    <main className="aurelia-app" data-theme={preferences.theme}>
      <header
        className="aurelia-topbar"
        onPointerDown={(event) => {
          if (event.button === 0 && event.detail === 1 && !(event.target as Element).closest('button'))
            void startDesktopWindowDrag();
        }}
        onDoubleClick={(event) => {
          if (!(event.target as Element).closest('button')) void toggleMaximizeCurrentDesktopWindow();
        }}
      >
        <div className="aurelia-brand">
          <span className="aurelia-sigil">
            <Sparkles size={19} />
          </span>
          <div>
            <strong>Servant</strong>
            <span>CHARACTER DRAMA ENGINE</span>
          </div>
        </div>
        <div className="aurelia-statusline">
          <span>
            <i /> Runtime Online
          </span>
          <span>Servant · Main</span>
          <span className="aurelia-version">V0.1.0 PREVIEW</span>
        </div>
        {isTauriDesktop() ? (
          <div className="aurelia-window-controls" aria-label="窗口控制">
            <button
              type="button"
              aria-label="最小化"
              title="最小化"
              onClick={() => void minimizeCurrentDesktopWindow()}
            >
              <Minus size={16} />
            </button>
            <button
              type="button"
              aria-label="最大化或还原"
              title="最大化 / 还原"
              onClick={() => void toggleMaximizeCurrentDesktopWindow()}
            >
              <Maximize2 size={14} />
            </button>
            <button
              type="button"
              aria-label="关闭设置"
              title="关闭设置"
              data-close
              onClick={() => void closeCurrentDesktopWindow()}
            >
              <X size={17} />
            </button>
          </div>
        ) : null}
      </header>

      <div className="aurelia-frame">
        <aside className="aurelia-sidebar" aria-label="主要设置">
          <div className="aurelia-sidebar-heading">
            <span>控制中枢</span>
            <small>CONTROL NEXUS</small>
          </div>
          <nav>
            {settingsSections.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  type="button"
                  key={item.id}
                  className="aurelia-nav-item"
                  data-active={item.id === section}
                  onClick={() => setSection(item.id)}
                >
                  <Icon size={18} strokeWidth={1.6} />
                  <span>
                    {item.label}
                    <small>{item.eyebrow}</small>
                  </span>
                  <ChevronRight size={14} />
                </button>
              );
            })}
          </nav>
          <div className="aurelia-sidebar-foot">
            <ShieldCheck size={16} />
            <span>
              本地模式<small>LOCAL · SECURE</small>
            </span>
          </div>
        </aside>

        <section className="aurelia-workspace">
          <div className="aurelia-page-title">
            <div>
              <span>{current.eyebrow} Configuration</span>
              <h1>{current.label}</h1>
            </div>
            <span className="aurelia-diamond" aria-hidden="true" />
          </div>

          <SettingsSection
            autoStart={autoStart}
            preferences={preferences}
            section={section}
            setPreferences={setPreferences}
          />
        </section>
      </div>
    </main>
  );
}

function SettingsSection({
  section,
  preferences,
  setPreferences,
  autoStart
}: {
  section: SettingsSectionId;
  preferences: UiPreferences;
  setPreferences: Dispatch<SetStateAction<UiPreferences>>;
  autoStart: AutoStartStatus;
}) {
  switch (section) {
    case 'system':
      return (
        <SystemSettings autoStart={autoStart} preferences={preferences} setPreferences={setPreferences} />
      );
    case 'character-settings':
      return <CharacterSettings />;
    case 'character-panel':
      return <CharacterStatePanel />;
    case 'memoir':
      return <MemoirSettings />;
    case 'live':
      return <LiveSettings />;
    case 'actions':
      return <ActionSettings />;
    case 'games':
      return <GameSettings />;
    case 'llm':
      return <LlmSettings preferences={preferences} />;
    case 'tts':
      return <TtsSettings preferences={preferences} />;
    case 'logs':
      return <LogsPanel />;
    default:
      return null;
  }
}
