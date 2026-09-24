import { type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { formatNumber } from './settingsState';

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="aurelia-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function PanelTitle({ title, eyebrow }: { title: string; eyebrow: string }) {
  return (
    <header className="aurelia-panel-title">
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      <i />
    </header>
  );
}

export function ControlGroup({
  title,
  children,
  enabled,
  onEnabledChange
}: {
  title: string;
  children: ReactNode;
  enabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
}) {
  const toggleable = enabled !== undefined && onEnabledChange !== undefined;
  return (
    <fieldset className="aurelia-control-group" data-collapsed={toggleable ? !enabled : undefined}>
      <legend>
        <span>{title}</span>
        {toggleable ? <Toggle checked={enabled} label={title} onChange={onEnabledChange} /> : null}
      </legend>
      <div className="aurelia-control-group-content">{children}</div>
    </fieldset>
  );
}

export function SettingRow({
  title,
  description,
  control
}: {
  title: string;
  description: string;
  control: ReactNode;
}) {
  return (
    <div className="aurelia-setting-row">
      <div>
        <strong>{title}</strong>
        <small>{description}</small>
      </div>
      {control}
    </div>
  );
}

export function FakeToggle({ active = false }: { active?: boolean }) {
  return (
    <span className="aurelia-toggle" data-active={active}>
      <i />
    </span>
  );
}

export function ConfirmModal({
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onCancel(): void;
  onConfirm(): void;
}) {
  return (
    <div
      className="aurelia-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        aria-describedby="confirm-description"
        aria-labelledby="confirm-title"
        aria-modal="true"
        className="aurelia-confirm-modal"
        role="dialog"
      >
        <div className="aurelia-confirm-icon">
          <Trash2 size={20} />
        </div>
        <div>
          <h2 id="confirm-title">{title}</h2>
          <p id="confirm-description">{description}</p>
        </div>
        <div className="aurelia-confirm-actions">
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button className="danger" type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

export function Toggle({
  checked,
  label,
  disabled = false,
  onChange
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="aurelia-toggle aurelia-toggle-button"
      data-active={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <i />
    </button>
  );
}

export function ControlRange({
  label,
  min,
  max,
  step,
  value,
  onChange
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange(value: number): void;
}) {
  return (
    <label className="aurelia-control-range">
      <span>
        {label}
        <output>{formatNumber(value)}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

export function StateRange({
  icon,
  label,
  value,
  onChange,
  min = 0,
  max = 100
}: {
  icon?: ReactNode;
  label: string;
  value: number;
  onChange(value: number): void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="aurelia-state-range">
      <span>
        {icon}
        {label}
        <strong>{Math.round(value)}</strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}
