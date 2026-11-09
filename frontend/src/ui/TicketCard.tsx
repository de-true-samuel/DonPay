import type { ReactNode } from 'react';
import { cls } from '../lib/cls';
import { Money } from './Money';
import type { Trust } from './Trust';

/** A payment request as a ticket: who it's for on top, the exact amount below the tear line. */
export function TicketCard({ title, subtitle, amountKobo, status, aside, footer, trust, ghost }: {
  title: ReactNode; subtitle?: string; amountKobo: string; status: ReactNode;
  aside?: ReactNode; footer?: ReactNode; trust?: Trust; ghost?: boolean;
}) {
  return (
    <article className={cls('pd-ticket', trust && `pd-ticket--${trust}`, ghost && 'pd-ticket--ghost')}>
      <div className="pd-ticket__top">
        <div className="pd-ticket__who">
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {aside}
      </div>
      <div className="pd-ticket__cut" aria-hidden="true"><i /><i /></div>
      <div className="pd-ticket__bottom">
        <Money kobo={amountKobo} size="lg" />
        {status}
      </div>
      {footer && <div className="pd-ticket__foot">{footer}</div>}
    </article>
  );
}
