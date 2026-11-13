import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { JobSummary, Payment, PaymentRequest, ReviewItem } from '../../contract/contract';
import { MOCK } from '../../config';
import { REVIEW_LABEL } from '../../lib/review';
import { ResolveDialog } from '../review/ResolveDialog';
import { cls } from '../../lib/cls';
import { formatNaira } from '../../lib/money';
import { formatDate, timeAgo } from '../../lib/time';
import { CountdownRing } from '../../ui/CountdownRing';
import { Money } from '../../ui/Money';
import { Button } from '../../ui/primitives';
import { ReadyBadge, StatusPill, TrustBadge } from '../../ui/Trust';
import { TicketCard } from '../../ui/TicketCard';
import { useToast } from '../../ui/Toast';
import { useCopiedAt } from '../requests/copyTracker';
import { KIND_LABEL } from '../requests/RequestCard';
import { useRequestActions } from '../requests/useRequestActions';

export { REVIEW_LABEL };

/** A compact line for things that need a nudge but not a full ticket. */
function QueueRow({ to, title, sub, right, action, tone }: {
  to: string; title: string; sub: string; right?: ReactNode; action?: ReactNode; tone?: 'bad' | 'wait';
}) {
  return (
    <div className={cls('pd-qrow', tone && `pd-qrow--${tone}`)}>
      <div className="pd-qrow__main">
        <Link to={to} className="pd-plainlink"><strong>{title}</strong></Link>
        <p>{sub}</p>
      </div>
      <div className="pd-qrow__side">{right}{action}</div>
    </div>
  );
}

export function SettledPaymentRow({ payment, job }: { payment: Payment; job: JobSummary }) {
  const a = useRequestActions();
  const initial = (job.customer.name.trim().charAt(0) || 'C').toUpperCase();
  const verified = payment.source === 'KORA_VERIFIED';

  return (
    <div className="pd-settled-item">
      <div className="pd-item-left">
        <span className="pd-avatar-disc pd-avatar-disc--mint" aria-hidden="true">{initial}</span>
        <div className="pd-item-info">
          <h4><Link to={`/jobs/${job.id}`} className="pd-plainlink">{job.customer.name}</Link></h4>
          <p>{job.service} · {timeAgo(payment.receivedAt)}</p>
        </div>
      </div>
      <div className="pd-item-right">
        <span className="pd-settled-amt">+{formatNaira(payment.amountKobo)}</span>
        <span className="pd-settled-tag">
          {verified ? '✓ Kora Verified' : 'Cash/POS'}
        </span>
        <Button
          variant="quiet"
          style={{ padding: '2px 8px', fontSize: 12, marginTop: 4 }}
          busy={a.receipt.isPending && a.receipt.variables?.paymentId === payment.id}
          onClick={() => a.receipt.mutate({ paymentId: payment.id, customerName: job.customer.name })}
        >
          Share receipt
        </Button>
      </div>
    </div>
  );
}

export function ActivePaymentRow({ request: r, job }: { request: PaymentRequest; job: JobSummary }) {
  const a = useRequestActions();
  const qc = useQueryClient();
  const toast = useToast();
  const copiedAt = useCopiedAt(r.id);
  const initial = (job.customer.name.trim().charAt(0) || 'C').toUpperCase();

  return (
    <div className="pd-active-item">
      <div className="pd-active-item__top">
        <div className="pd-item-left">
          <span className="pd-avatar-disc pd-avatar-disc--violet" aria-hidden="true">{initial}</span>
          <div className="pd-item-info">
            <h4><Link to={`/jobs/${job.id}`} className="pd-plainlink">{job.customer.name}</Link></h4>
            <p>{job.service} · <strong style={{ color: 'var(--ink)' }}>{formatNaira(r.amountKobo)}</strong></p>
          </div>
        </div>
        <div className="pd-active-badges">
          {copiedAt ? (
            <span className="pd-chip-badge pd-chip-badge--teal">
              Copied {timeAgo(copiedAt)}
            </span>
          ) : (
            <span className="pd-chip-badge pd-chip-badge--amber">
              Not copied yet
            </span>
          )}
          {r.customerClaimedPaidAt && (
            <span className="pd-chip-badge pd-chip-badge--claimed">
              Customer says paid ({timeAgo(r.customerClaimedPaidAt)})
            </span>
          )}
        </div>
      </div>

      <div className="pd-active-item__actions">
        <div className="pd-active-countdown">
          {r.sentAt && r.expiresAt && <CountdownRing sentAt={r.sentAt} expiresAt={r.expiresAt} />}
          <span>{r.bankName ?? 'Wema Bank'} · {r.accountNumber ?? 'Account allocated'}</span>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {r.customerClaimedPaidAt && (
            <Button
              variant="line"
              style={{ padding: '4px 10px', fontSize: 13 }}
              onClick={() => {
                void qc.invalidateQueries({ queryKey: ['today'] });
                void qc.invalidateQueries({ queryKey: ['jobs'] });
                toast.info('Checking with bank for payments…');
              }}
            >
              Check now
            </Button>
          )}
          <Button
            variant="line"
            style={{ padding: '4px 12px', fontSize: 13 }}
            busy={a.shareAgain.isPending && a.shareAgain.variables?.request.id === r.id}
            onClick={() => a.shareAgain.mutate({ request: r, job })}
          >
            Copy details
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PaidItem({ payment, job }: { payment: Payment; job: JobSummary }) {
  const a = useRequestActions();
  const kind = payment.source === 'MANUAL' ? 'manual' : payment.payerDetailsSimulated ? 'simulated' : 'verified';
  return (
    <TicketCard
      title={<Link to={`/jobs/${job.id}`} className="pd-plainlink">{job.customer.name} · {job.service}</Link>}
      subtitle={`Paid ${timeAgo(payment.receivedAt)}`}
      amountKobo={payment.amountKobo}
      trust={kind}
      status={job.readyToStart ? <ReadyBadge /> : <StatusPill status="PAID" />}
      footer={
        <div className="pd-actions">
          <TrustBadge kind={kind} />
          <Button variant="line" busy={a.receipt.isPending && a.receipt.variables?.paymentId === payment.id}
            onClick={() => a.receipt.mutate({ paymentId: payment.id, customerName: job.customer.name })}>Share receipt</Button>
        </div>
      }
    />
  );
}

export function BalanceRow({ job }: { job: JobSummary }) {
  const a = useRequestActions();
  const overdue = !!job.balanceDueAt && Date.parse(job.balanceDueAt) < Date.now();
  const due = job.balanceDueAt ? `${overdue ? 'Overdue since' : 'Due'} ${formatDate(job.balanceDueAt)}` : 'Balance outstanding';
  return (
    <QueueRow to={`/jobs/${job.id}`} title={`${job.customer.name} · ${job.service}`} sub={due} tone={overdue ? 'bad' : 'wait'}
      right={<Money kobo={job.balanceKobo} size="md" />}
      action={<Button variant="line" busy={a.balance.isPending && a.balance.variables === job.id}
        onClick={() => a.balance.mutate(job.id)}>Get balance details</Button>} />
  );
}

export function ExpiredRow({ request, job }: { request: PaymentRequest; job: JobSummary }) {
  const a = useRequestActions();
  return (
    <QueueRow to={`/jobs/${job.id}`} title={`${job.customer.name} · ${job.service}`} tone="bad"
      sub={`${KIND_LABEL[request.kind]} expired ${request.expiresAt ? timeAgo(request.expiresAt) : ''}`}
      right={<Money kobo={request.amountKobo} size="md" />}
      action={
        <div className="pd-actions">
          <Button busy={a.resend.isPending && a.resend.variables === request.id}
            onClick={() => a.resend.mutate(request.id)}>Get new details</Button>
          {MOCK && <Button variant="quiet" busy={a.simulate.isPending && a.simulate.variables === request.id}
            onClick={() => a.simulate.mutate(request.id)}>Late payment (demo)</Button>}
        </div>
      } />
  );
}

export function ReminderRow({ request, job }: { request: PaymentRequest; job: JobSummary }) {
  const a = useRequestActions();
  return (
    <QueueRow to={`/jobs/${job.id}`} title={`${job.customer.name} · ${job.service}`} tone="wait"
      sub={`Reminder due for ${KIND_LABEL[request.kind].toLowerCase()}`}
      right={<Money kobo={request.amountKobo} size="md" />}
      action={
        <Button busy={a.send.isPending && a.send.variables === request.id}
          onClick={() => a.send.mutate(request.id)}>Get payment details</Button>
      } />
  );
}

export function ReviewRow({ item }: { item: ReviewItem }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <QueueRow to={item.jobId ? `/jobs/${item.jobId}` : '/review'} title={REVIEW_LABEL[item.kind]} tone="bad" sub={item.message}
        action={
          <div className="pd-actions">
            {item.jobId && <Link className="pd-btn pd-btn--line" to={`/jobs/${item.jobId}`}><span>Open job</span></Link>}
            <Button onClick={() => setOpen(true)}>Resolve</Button>
          </div>
        } />
      <ResolveDialog item={item} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
