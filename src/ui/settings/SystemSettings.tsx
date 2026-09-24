import { type UiPreferences } from '../../app/settings/uiPreferences';

import { type Dispatch, type SetStateAction } from 'react';
import { PanelTitle, SettingRow, Toggle, ControlRange } from './SettingsControls';

/**
 * Describes the OS login-startup entry. Kept as a plain descriptor so this panel
 * stays free of any Tauri (or other backend) import.
 */
export interface AutoStartStatus {
  /** False where no OS entry can be managed (browser preview, or a build that cannot own one). */
  available: boolean;
  pending: boolean;
  error: string;
  /** Why no entry can be managed, when the shell said so; empty otherwise. */
  reason: string;
}

export function SystemSettings({
  preferences,
  setPreferences,
  autoStart = { available: false, pending: false, error: '', reason: '' }
}: {
  preferences: UiPreferences;
  setPreferences: Dispatch<SetStateAction<UiPreferences>>;
  autoStart?: AutoStartStatus;
}) {
  const update = <K extends keyof UiPreferences>(key: K, value: UiPreferences[K]) => {
    setPreferences((current) => ({ ...current, [key]: value }));
  };
  // A shell that cannot own an entry says so in `reason`; without one, the only
  // remaining reason a switch is dead is that there is no desktop shell at all.
  const autoStartDescription = autoStart.available
    ? '登录系统后自动唤醒 Servant'
    : autoStart.reason
      ? '登录系统后自动唤醒 Servant · 当前构建不支持'
      : '登录系统后自动唤醒 Servant · 仅桌面版可用';

  return (
    <div className="aurelia-content-grid">
      <section className="aurelia-panel aurelia-panel-wide">
        <PanelTitle title="全局设置" eyebrow="GENERAL" />
        <div className="aurelia-setting-list aurelia-setting-list-two">
          <SettingRow
            title="开机启动"
            description={autoStartDescription}
            control={
              <Toggle
                checked={preferences.autoStart}
                label="开机启动"
                disabled={!autoStart.available || autoStart.pending}
                onChange={(checked) => update('autoStart', checked)}
              />
            }
          />
          <SettingRow
            title="交互提示"
            description="显示角色状态提示与语音气泡"
            control={
              <Toggle
                checked={preferences.interactionHints}
                label="交互提示"
                onChange={(checked) => update('interactionHints', checked)}
              />
            }
          />
        </div>
        {autoStart.error ? (
          <p className="aurelia-setting-notice" role="alert">
            开机启动设置未生效：{autoStart.error}
          </p>
        ) : null}
        {autoStart.reason ? (
          <p className="aurelia-setting-notice">{autoStart.reason}</p>
        ) : null}
      </section>
      <section className="aurelia-panel">
        <PanelTitle title="界面主题" eyebrow="APPEARANCE" />
        <button
          className="aurelia-theme-card"
          data-selected={preferences.theme === 'nocturne'}
          onClick={() => update('theme', 'nocturne')}
          type="button"
        >
          <span className="aurelia-theme-orb" />
          <div>
            <strong>夜金 / Nocturne</strong>
            <small>{preferences.theme === 'nocturne' ? '当前主题' : '深色预设'}</small>
          </div>
        </button>
        <button
          className="aurelia-theme-card"
          data-selected={preferences.theme === 'moonlight'}
          onClick={() => update('theme', 'moonlight')}
          type="button"
        >
          <span className="aurelia-theme-orb silver" />
          <div>
            <strong>月银 / Moonlight</strong>
            <small>{preferences.theme === 'moonlight' ? '当前主题' : '浅色预设'}</small>
          </div>
        </button>
        <button
          className="aurelia-theme-card"
          data-selected={preferences.theme === 'sakura'}
          onClick={() => update('theme', 'sakura')}
          type="button"
          aria-pressed={preferences.theme === 'sakura'}
        >
          <span className="aurelia-theme-orb sakura" />
          <div>
            <strong>樱梦 / Sakura</strong>
            <small>{preferences.theme === 'sakura' ? '当前主题' : '粉紫壁纸 · 浅色预设'}</small>
          </div>
        </button>
        <div className="aurelia-font-size-control">
          <ControlRange
            label="主页字号"
            min={0.9}
            max={1.3}
            step={0.05}
            value={preferences.fontScale}
            onChange={(value) => update('fontScale', value)}
          />
          <small>当前 {Math.round(preferences.fontScale * 100)}% · 在这里调整主页整体字号</small>
        </div>
      </section>
      <section className="aurelia-panel">
        <PanelTitle title="全局代理与网络" eyebrow="NETWORK" />
        <div className="aurelia-select-row">
          <span>所有外部服务使用代理</span>
          <Toggle
            checked={preferences.proxyEnabled}
            label="使用全局代理"
            onChange={(checked) => update('proxyEnabled', checked)}
          />
        </div>
        <label className="aurelia-field">
          <span>服务地址</span>
          <input
            value={preferences.proxyUrl}
            onChange={(event) => update('proxyUrl', event.currentTarget.value)}
            placeholder="系统设置代理（默认 127.0.0.1:7890）"
          />
        </label>
      </section>
      <section className="aurelia-panel aurelia-panel-wide aurelia-version-panel">
        <PanelTitle title="版本信息" eyebrow="ABOUT" />
        <div>
          <strong>Character Drama Engine</strong>
          <span>Prototype · v0.1.0</span>
        </div>
        <small>Runtime / Action / Emotion / Live modules detected</small>
      </section>
    </div>
  );
}
