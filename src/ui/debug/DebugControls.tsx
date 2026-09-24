import { roundMotionTime } from './motionDebug';
import { type ReactNode } from 'react';
import { clampNumber } from './debugSettings';
import { type DebugPanelSectionId } from './debugConfig';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function MotionPhaseCutControl({
  label,
  max,
  value,
  onChange
}: {
  label: string;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="motionPhaseCutRow">
      <span>{label}</span>
      <input
        aria-label={`${label} slider`}
        max={max}
        min={0}
        step={0.01}
        type="range"
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <input
        aria-label={`${label} seconds`}
        className="motionPhaseNumberInput"
        max={max}
        min={0}
        step={0.01}
        type="number"
        value={roundMotionTime(value)}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

export function Slider({
  label,
  value,
  onChange
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="sliderRow">
      <span>{label}</span>
      <input
        min="0"
        max="1"
        step="0.01"
        type="range"
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <strong>{value.toFixed(2)}</strong>
    </label>
  );
}

export function RenderSlider({
  icon,
  label,
  min,
  max,
  step,
  value,
  onChange
}: {
  icon: ReactNode;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const displayValue = Number.isFinite(value) ? value : min;

  return (
    <label className="renderSliderRow">
      <span>
        {icon}
        {label}
      </span>
      <input
        min={min}
        max={max}
        step={step}
        type="range"
        value={displayValue}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <strong>{displayValue.toFixed(step < 0.1 ? 2 : 1)}</strong>
    </label>
  );
}

export function PreciseRenderSlider({
  icon,
  label,
  min,
  max,
  step,
  value,
  onChange
}: {
  icon: ReactNode;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const displayValue = Number.isFinite(value) ? value : min;

  return (
    <label className="renderSliderRow preciseRenderSliderRow">
      <span>
        {icon}
        {label}
      </span>
      <input
        min={min}
        max={max}
        step={step}
        type="range"
        value={displayValue}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <input
        aria-label={`${label} value`}
        className="preciseNumberInput"
        max={max}
        min={min}
        step={step}
        type="number"
        value={displayValue}
        onChange={(event) => onChange(clampNumber(Number(event.currentTarget.value), min, max))}
      />
      <button className="zeroButton" onClick={() => onChange(0)} title={`Set ${label} to zero`} type="button">
        0
      </button>
    </label>
  );
}

export function RenderGroupHeader({
  checked,
  label,
  onChange,
  toggleLabel
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  toggleLabel: string;
}) {
  return (
    <div className="renderGroupHeader">
      <h3>{label}</h3>
      <label className="renderGroupToggle" title={toggleLabel}>
        <span className="srOnly">{toggleLabel}</span>
        <input
          checked={checked}
          onChange={(event) => onChange(event.currentTarget.checked)}
          type="checkbox"
        />
      </label>
    </div>
  );
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function DebugSection({
  children,
  className,
  id,
  onToggle,
  open,
  title
}: {
  children: ReactNode;
  className?: string;
  id: DebugPanelSectionId;
  onToggle: (id: DebugPanelSectionId, open: boolean) => void;
  open: boolean;
  title: string;
}) {
  return (
    <section className={['panelSection', className].filter(Boolean).join(' ')}>
      <button
        aria-expanded={open}
        className="panelTitleButton"
        onClick={() => onToggle(id, !open)}
        title={open ? `Collapse ${title}` : `Expand ${title}`}
        type="button"
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <h2>{title}</h2>
      </button>
      {open ? <div className="collapsiblePanel">{children}</div> : null}
    </section>
  );
}

export function StateMeter({ label, value }: { label: string; value: number }) {
  const displayValue = clampNumber(value, 0, 100);

  return (
    <div className="stateMeter">
      <div>
        <span>{label}</span>
        <strong>{Math.round(displayValue)}</strong>
      </div>
      <meter max={100} min={0} value={displayValue} />
    </div>
  );
}
