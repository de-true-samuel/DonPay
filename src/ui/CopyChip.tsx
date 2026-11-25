import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { cls } from '../lib/cls';
import { copyText } from '../lib/copy';
import { hapticCopy } from '../lib/feedback';
import { Icon } from './Icon';

/**
 * Copy Chip with 260ms Mint Ink-flood radial sweep, 1600ms Copied confirmation,
 * 12ms tactile haptic, and aria-live="polite" screen-reader announcement (§3.12 & §4.11).
 */
export function CopyChip({
  value,
  label,
  copyLabel,
  mono = true,
  className,
  onCopied,
}: {
  value: string;
  label?: string;
  copyLabel?: string;
  mono?: boolean;
  className?: string;
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState<{ x: string; y: string }>({ x: '50%', y: '50%' });
  const btnRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  async function handleCopy(e: MouseEvent<HTMLButtonElement>) {
    if (!value) return;
    if (btnRef.current && e.clientX && e.clientY) {
      const rect = btnRef.current.getBoundingClientRect();
      setOrigin({
        x: `${Math.round(e.clientX - rect.left)}px`,
        y: `${Math.round(e.clientY - rect.top)}px`,
      });
    } else {
      setOrigin({ x: '50%', y: '50%' });
    }

    const ok = await copyText(value);
    if (!ok) return;
    hapticCopy();
    setCopied(true);
    onCopied?.();
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      ref={btnRef}
      type="button"
      className={cls('pd-copy-chip', 'ob-copy-chip', copied && 'pd-copy-chip--copied', mono && 'pd-mono', className)}
      style={{ '--cx': origin.x, '--cy': origin.y } as React.CSSProperties}
      onClick={(e) => void handleCopy(e)}
      aria-label={copied ? `${copyLabel || label || 'Value'} copied` : `Copy ${copyLabel || label || value}`}
    >
      <span className="ob-copy-chip__flood" aria-hidden="true" />
      <Icon name={copied ? 'check' : 'copy'} size={15} />
      <span>{copied ? 'Copied' : label ?? value}</span>
      <span className="pd-sr-only" aria-live="polite">
        {copied ? `${copyLabel || label || 'Value'} copied` : ''}
      </span>
    </button>
  );
}
