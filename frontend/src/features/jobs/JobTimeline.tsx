import { cls } from '../../lib/cls';
import { formatDateTime } from '../../lib/time';
import type { TimelineItem } from '../../lib/timeline';
import { Money } from '../../ui/Money';
import { Button } from '../../ui/primitives';
import { TrustBadge } from '../../ui/Trust';

/** One story per job. The dot's line style repeats the trust grammar: solid verified, dashed by hand, dotted simulated. */
export function JobTimeline({ items, onReceipt, receiptBusy }: {
  items: TimelineItem[]; onReceipt: (paymentId: string) => void; receiptBusy?: string;
}) {
  return (
    <ol className="pd-tl">
      {items.map((i) => (
        <li key={i.id} className={cls('pd-tl__item', `pd-tl__item--${i.kind}`, i.trust && `pd-tl__item--${i.trust}`)}>
          <span className="pd-tl__dot" aria-hidden="true" />
          <div className="pd-tl__body">
            <p className="pd-tl__label">{i.label}</p>
            <p className="pd-hint">{formatDateTime(i.at)}{i.detail ? ` · ${i.detail}` : ''}</p>
            {i.trust && i.paymentId && (
              <div className="pd-actions">
                <TrustBadge kind={i.trust} />
                <Button variant="line" busy={receiptBusy === i.paymentId} onClick={() => onReceipt(i.paymentId!)}>Share receipt</Button>
              </div>
            )}
          </div>
          {i.amountKobo && <Money kobo={i.amountKobo} size="sm" />}
        </li>
      ))}
    </ol>
  );
}
