import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cls } from '../lib/cls';
import { Money } from './Money';
import type { Trust } from './Trust';

export type TicketState =
  | 'draft'
  | 'reminder'
  | 'waiting'
  | 'copied'
  | 'claims'
  | 'paid'
  | 'expired'
  | 'cancelled'
  | 'review';

/**
 * Signal Ticket (§4.5):
 * Top: Identity + Chrono Ring dial
 * Mid: Custom account / bank zone children + optional Solar scan line when CLAIMED
 * Cut: Semicircular notches + dashed perforation
 * Bottom Stub: <Money size="lg"> + Status + Footer
 */
export function TicketCard({
  title,
  subtitle,
  amountKobo,
  status,
  aside,
  footer,
  trust,
  ghost,
  hero,
  state,
  stamp,
  simulated,
  children,
}: {
  title: ReactNode;
  subtitle?: string;
  amountKobo: string;
  status: ReactNode;
  aside?: ReactNode;
  footer?: ReactNode;
  trust?: Trust;
  ghost?: boolean;
  hero?: boolean;
  state?: TicketState;
  stamp?: 'PAID' | 'EXPIRED' | 'CANCELLED' | string;
  simulated?: boolean;
  children?: ReactNode;
}) {
  const resolvedState = state || (ghost ? 'draft' : undefined);
  const resolvedStamp =
    stamp ||
    (resolvedState === 'paid'
      ? 'PAID'
      : resolvedState === 'expired'
        ? 'EXPIRED'
        : resolvedState === 'cancelled'
          ? 'CANCELLED'
          : null);

  const isAuthoritativePaid = resolvedState === 'paid' && trust !== 'manual' && !simulated;
  const prevPaidRef = useRef(isAuthoritativePaid);
  const [slamming, setSlamming] = useState(false);
  const [shockwave, setShockwave] = useState(false);

  // Trigger stamp slam & Mint payment shockwave once on transition to authoritative PAID (§4.5 & §4.8)
  useEffect(() => {
    const justVerified = !prevPaidRef.current && isAuthoritativePaid;
    prevPaidRef.current = isAuthoritativePaid;
    if (!justVerified) return;
    setSlamming(true);
    setShockwave(true);
    const t1 = window.setTimeout(() => setSlamming(false), 320);
    const t2 = window.setTimeout(() => setShockwave(false), 700);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [isAuthoritativePaid]);

  const showFoil =
    (hero || resolvedState === 'waiting' || resolvedState === 'copied' || resolvedState === 'claims') &&
    resolvedState !== 'draft' &&
    resolvedState !== 'expired' &&
    resolvedState !== 'cancelled';

  const paymentMethodAttr = trust === 'manual' ? 'manual' : undefined;

  return (
    <article
      className={cls(
        'pd-ticket',
        'ob-ticket',
        showFoil && 'ob-foil',
        hero && 'ob-ticket--hero',
        slamming && 'is-slamming',
        resolvedState && `pd-ticket--${resolvedState}`,
        trust && `pd-ticket--${trust}`,
        ghost && 'pd-ticket--ghost',
      )}
      data-state={resolvedState}
      data-payment-method={paymentMethodAttr}
      data-simulated={simulated || trust === 'simulated' ? 'true' : undefined}
    >
      {/* Expanding Mint shockwave rings on authoritative bank credit (§4.8) */}
      {shockwave && (
        <span className="ob-shockwave" aria-hidden="true">
          <i className="ob-shockwave__ring ob-shockwave__ring--1" />
          <i className="ob-shockwave__ring ob-shockwave__ring--2" />
        </span>
      )}

      {/* Solar radar scan line when customer claims paid on full effects tier (§3.12 & §4.5) */}
      {resolvedState === 'claims' && <span className="ob-ticket__scanline" aria-hidden="true" />}

      {resolvedStamp && (
        <div
          className={cls(
            'pd-ticket__stamp',
            resolvedStamp === 'PAID' && 'pd-stamp--paid',
            resolvedStamp === 'EXPIRED' && 'pd-stamp--expired',
            resolvedStamp === 'CANCELLED' && 'pd-stamp--cancelled',
            slamming && 'is-slam',
          )}
          aria-hidden="true"
        >
          {resolvedStamp}
        </div>
      )}

      <div className="pd-ticket__top">
        <div className="pd-ticket__who">
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {aside}
      </div>

      {children}

      <div className="pd-ticket__cut" aria-hidden="true">
        <i />
        <i />
      </div>

      <div className="pd-ticket__bottom">
        <Money
          kobo={amountKobo}
          size="lg"
          tone={isAuthoritativePaid ? 'mint' : resolvedState === 'review' ? 'flare' : undefined}
        />
        {status}
      </div>

      {footer && <footer className="pd-ticket__foot">{footer}</footer>}
    </article>
  );
}
