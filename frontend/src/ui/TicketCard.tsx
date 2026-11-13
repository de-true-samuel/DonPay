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
 * A payment request as a physical ticket:
 * Top: Customer identity + tag / dial
 * Cut: Notches + tear line
 * Bottom Stub: The exact amount + bank / status
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
  state,
  stamp,
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
  state?: TicketState;
  stamp?: 'PAID' | 'EXPIRED' | 'CANCELLED' | string;
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

  return (
    <article
      className={cls(
        'pd-ticket',
        resolvedState && `pd-ticket--${resolvedState}`,
        trust && `pd-ticket--${trust}`,
        ghost && 'pd-ticket--ghost'
      )}
      data-state={resolvedState}
    >
      {resolvedStamp && (
        <div
          className={cls(
            'pd-ticket__stamp',
            resolvedStamp === 'PAID' && 'pd-stamp--paid',
            resolvedStamp === 'EXPIRED' && 'pd-stamp--expired',
            resolvedStamp === 'CANCELLED' && 'pd-stamp--cancelled'
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
        <Money kobo={amountKobo} size="lg" />
        {status}
      </div>

      {footer && <div className="pd-ticket__foot">{footer}</div>}
    </article>
  );
}
