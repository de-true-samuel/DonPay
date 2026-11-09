import { forwardRef, useId } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LinkProps } from 'react-router-dom';
import { cls } from '../lib/cls';
import { Icon } from './Icon';
import type { IconName } from './Icon';

type Variant = 'primary' | 'line' | 'quiet' | 'danger';
interface BtnExtras { variant?: Variant; icon?: IconName; block?: boolean }

export function Button({
  variant = 'primary', icon, block, busy, className, children, disabled, ...rest
}: BtnExtras & { busy?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} disabled={disabled || busy} aria-busy={busy || undefined}
      className={cls('pd-btn', `pd-btn--${variant}`, block && 'pd-btn--block', className)}>
      {icon && <Icon name={icon} size={18} />}
      <span>{children}</span>
    </button>
  );
}

export function LinkButton({
  variant = 'primary', icon, block, className, children, ...rest
}: BtnExtras & LinkProps) {
  return (
    <Link {...rest} className={cls('pd-btn', `pd-btn--${variant}`, block && 'pd-btn--block', className)}>
      {icon && <Icon name={icon} size={18} />}
      <span>{children}</span>
    </Link>
  );
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string; hint?: string; error?: string;
}
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, className, ...rest }, ref,
) {
  const id = useId();
  const note = error ? `${id}-e` : hint ? `${id}-h` : undefined;
  return (
    <div className="pd-field">
      <label htmlFor={id} className="pd-label">{label}</label>
      <input ref={ref} id={id} aria-invalid={error ? true : undefined} aria-describedby={note}
        className={cls('pd-input', error && 'pd-input--bad', className)} {...rest} />
      {error ? <p id={`${id}-e`} className="pd-error" role="alert">{error}</p>
        : hint ? <p id={`${id}-h`} className="pd-hint">{hint}</p> : null}
    </div>
  );
});

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label}
      className={cls('pd-switch', checked && 'is-on')} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function ChoiceCards<T extends string>({ legend, value, options, onChange }: {
  legend: string; value: T; onChange: (v: T) => void;
  options: Array<{ value: T; title: string; text: string }>;
}) {
  const name = useId();
  return (
    <fieldset className="pd-choices">
      <legend className="pd-label">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className={cls('pd-choice', o.value === value && 'is-on')}>
          <input type="radio" name={name} checked={o.value === value} onChange={() => onChange(o.value)} />
          <span className="pd-choice__title">{o.title}</span>
          <span className="pd-choice__text">{o.text}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function Banner({ tone = 'info', action, children }: { tone?: 'info' | 'warn' | 'bad'; action?: ReactNode; children: ReactNode }) {
  return (
    <div className={cls('pd-banner', `pd-banner--${tone}`)} role={tone === 'bad' ? 'alert' : 'status'}>
      <Icon name={tone === 'info' ? 'clock' : 'alert'} size={18} />
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Skeleton({ w = '100%', h = 16 }: { w?: number | string; h?: number }) {
  return <div className="pd-skel" style={{ width: w, height: h }} aria-hidden="true" />;
}

export function EmptyState({ title, action, children }: { title: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <section className="pd-empty">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </section>
  );
}

/** Development-only note about what a later phase fills in. Hidden in production builds. */
export function PhaseNote({ phase, children }: { phase: number; children: ReactNode }) {
  if (!import.meta.env.DEV) return null;
  return <p className="pd-phase">Phase {phase}: {children}</p>;
}

export function Segmented<T extends string>({ legend, value, options, onChange }: {
  legend: string; value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>;
}) {
  const name = useId();
  return (
    <fieldset className="pd-seg">
      <legend className="pd-label">{legend}</legend>
      <div className="pd-seg__row">
        {options.map((o) => (
          <label key={o.value} className={cls('pd-seg__opt', o.value === value && 'is-on')}>
            <input type="radio" name={name} checked={o.value === value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Chips<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="pd-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={cls('pd-chip', o.value === value && 'is-on')}
          aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function SearchField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="pd-field">
      <label htmlFor={id} className="pd-sr-only">{label}</label>
      <div className="pd-searchbox">
        <Icon name="search" size={18} />
        <input id={id} type="search" className="pd-input" value={value} placeholder={placeholder}
          autoComplete="off" onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

export function MultiChips<T extends string>({ label, values, options, onToggle }: {
  label: string; values: T[]; onToggle: (v: T) => void; options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="pd-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={cls('pd-chip', values.includes(o.value) && 'is-on')}
          aria-pressed={values.includes(o.value)} onClick={() => onToggle(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** Saved views: one is always active. Underlined, so they read as places, not filters. */
export function ViewTabs<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>;
}) {
  return (
    <nav className="pd-vtabs" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={cls('pd-vtab', o.value === value && 'is-on')}
          aria-current={o.value === value ? 'true' : undefined} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </nav>
  );
}
