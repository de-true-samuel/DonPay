import { useCallback, useEffect, useRef, useState } from 'react';
import { cls } from '../lib/cls';
import { hapticHoldComplete } from '../lib/feedback';

const HOLD_MS = 1200;

/**
 * Destructive Hold-to-Confirm button (§3.12 & §4.2):
 * Flare fill advances left-to-right over 1200ms while pointer or Space is held;
 * releasing early cancels with a 160ms rewind.
 */
export function HoldConfirmButton({
  label,
  holdingLabel = 'Keep holding…',
  busy,
  disabled,
  onConfirm,
  className,
  dataFlowId,
}: {
  label: string;
  holdingLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  className?: string;
  dataFlowId?: string;
}) {
  const [holding, setHolding] = useState(false);
  const timerRef = useRef<number | null>(null);
  const completedRef = useRef(false);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setHolding(false);
  }, []);

  useEffect(() => cancel, [cancel]);

  const start = () => {
    if (disabled || busy || holding) return;
    completedRef.current = false;
    setHolding(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      completedRef.current = true;
      setHolding(false);
      hapticHoldComplete();
      onConfirm();
    }, HOLD_MS);
  };

  return (
    <button
      type="button"
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      data-flow-id={dataFlowId}
      className={cls('pd-btn', 'pd-btn--danger', 'ob-hold-btn', holding && 'is-holding', className)}
      onPointerDown={() => start()}
      onPointerUp={() => cancel()}
      onPointerLeave={() => cancel()}
      onPointerCancel={() => cancel()}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          cancel();
        }
      }}
    >
      <span className="ob-hold-btn__fill" aria-hidden="true" />
      <span className="ob-hold-btn__text">{busy ? 'Working…' : holding ? holdingLabel : `${label} (hold)`}</span>
    </button>
  );
}
