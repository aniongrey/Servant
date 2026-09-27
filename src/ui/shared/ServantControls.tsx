import { createPortal } from 'react-dom';
import { useEffect, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { X } from 'lucide-react';
import './servant-controls.css';

type Variant = 'primary' | 'secondary' | 'danger' | 'quiet';

export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button {...props} className={`servant-button servant-button--${variant} ${className}`.trim()} />;
}

export function TextInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`servant-field ${className}`.trim()} />;
}

export function SelectInput({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`servant-field servant-select ${className}`.trim()} />;
}

export function TextAreaInput({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`servant-field servant-textarea ${className}`.trim()} />;
}

export function RangeInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`servant-range ${className}`.trim()} type="range" />;
}

export function Dialog({
  title,
  description,
  children,
  actions,
  onClose,
  className = ''
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions: ReactNode;
  onClose(): void;
  className?: string;
}) {
  const titleId = useId();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  const content = (
    <div className="servant-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-labelledby={titleId} aria-modal="true" className={`servant-dialog ${className}`.trim()} role="dialog">
        <header className="servant-dialog-header"><div><h2 id={titleId}>{title}</h2>{description ? <p>{description}</p> : null}</div><Button aria-label="关闭" className="servant-dialog-close" onClick={onClose} type="button" variant="quiet"><X size={18} /></Button></header>
        <div className="servant-dialog-content">{children}</div>
        <footer className="servant-dialog-actions">{actions}</footer>
      </section>
    </div>
  );
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}
