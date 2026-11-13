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

/** A compact notched slip for queues on the ground (Spec Section 4.6). */
function QueueSlip({
  to,
  title,
  sub,
  right,
  action,
  tone,
}: {
  to: string;
  title: string;
  sub: string;
  right?: ReactNode;
  action?: ReactNode;
  tone?: 'bad' | 'wait';
}) {
  return (
    <div className={cls('pd-slip', tone && `pd-slip--${tone}`)}>
      <div className="pd-slip__main">
        <Link to={to} className="pd-plainlink">
          <strong className="pd-slip__name">{title}</strong>
        </Link>
        <p className="pd-slip__meta">{sub}</p>
      </div>
      <div className="pd-slip__side">
        {right && <div className="pd-slip__amt">{right}</div>}
        {action}
      </div>
    </div>
  );
}

/** Mini receipt for the Just Paid strip (Spec Section 5.6) */
export function SettledPaymentRow({ payment, job }: { payment: Payment; job: JobSummary }) {
  const a = useRequestActions();
  return (
    <div className="pd-mini-receipt">
      <div>
        <h4 className="pd-mini-receipt__who">
          <Link to={`/jobs/${job.id}`} className="pd-plainlink">
            {job.customer.name}
          </Link>
        </h4>
        <p className="pd-mini-receipt__sub">
          {job.service} · {timeAgo(payment.receivedAt)}
        </p>
      </div>
      <div className="pd-mini-receipt__amt">+{formatNaira(payment.amountKobo)}</div>
      <Button
        variant="line"
        style={{ padding: '4px 10px', fontSize: 13 }}
        busy={a.receipt.isPending && a.receipt.variables?.paymentId === payment.id}
        onClick={() => a.receipt.mutate({ paymentId: payment.id, customerName: job.customer.name })}
      >
        Copy receipt message
      </Button>
    </div>
  );
}

/** Active payment waiting in 60-min window */
export function ActivePaymentRow({
  request: r,
  job,
}: {
  request: PaymentRequest;
  job: JobSummary;
}) {
  const a = useRequestActions();
  const qc = useQueryClient();
  const toast = useToast();
  const copiedAt = useCopiedAt(r.id);

  return (
    <div className="pd-slip">
      <div className="pd-slip__main">
        <Link to={`/jobs/${job.id}`} className="pd-plainlink">
          <strong className="pd-slip__name">{job.customer.name}</strong>
        </Link>
        <p className="pd-slip__meta">
          {job.service} · {r.bankName ?? 'Wema Bank'} ·{' '}
          {copiedAt ? `Copied ${timeAgo(copiedAt)}` : 'Not copied yet'}
        </p>
      </div>

      <div className="pd-slip__side">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {r.sentAt && r.expiresAt && <CountdownRing sentAt={r.sentAt} expiresAt={r.expiresAt} />}
          <span className="pd-slip__amt">{formatNaira(r.amountKobo)}</span>
        </div>

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
          {copiedAt ? 'Copy details again' : 'Copy message'}
        </Button>
      </div>
    </div>
  );
}

export function PaidItem({ payment, job }: { payment: Payment; job: JobSummary }) {
  const a = useRequestActions();
  const kind =
    payment.source === 'MANUAL'
      ? 'manual'
      : payment.payerDetailsSimulated
        ? 'simulated'
        : 'verified';
  return (
    <TicketCard
      title={
        <Link to={`/jobs/${job.id}`} className="pd-plainlink">
          {job.customer.name} · {job.service}
        </Link>
      }
      subtitle={`Paid ${timeAgo(payment.receivedAt)}`}
      amountKobo={payment.amountKobo}
      trust={kind}
      state="paid"
      status={job.readyToStart ? <ReadyBadge /> : <StatusPill status="PAID" />}
      footer={
        <div className="pd-actions">
          <TrustBadge kind={kind} />
          <Button
            variant="line"
            busy={a.receipt.isPending && a.receipt.variables?.paymentId === payment.id}
            onClick={() =>
              a.receipt.mutate({ paymentId: payment.id, customerName: job.customer.name })
            }
          >
            Copy receipt message
          </Button>
        </div>
      }
    />
  );
}

export function BalanceRow({ job }: { job: JobSummary }) {
  const a = useRequestActions();
  const overdue = !!job.balanceDueAt && Date.parse(job.balanceDueAt) < Date.now();
  const due = job.balanceDueAt
    ? `${overdue ? 'Overdue since' : 'Due'} ${formatDate(job.balanceDueAt)}`
    : 'Balance outstanding';
  return (
    <QueueSlip
      to={`/jobs/${job.id}`}
      title={`${job.customer.name} · ${job.service}`}
      sub={due}
      tone={overdue ? 'bad' : 'wait'}
      right={<Money kobo={job.balanceKobo} size="md" />}
      action={
        <Button
          variant="line"
          busy={a.balance.isPending && a.balance.variables === job.id}
          onClick={() => a.balance.mutate(job.id)}
        >
          Get balance details
        </Button>
      }
    />
  );
}

export function ExpiredRow({ request, job }: { request: PaymentRequest; job: JobSummary }) {
  const a = useRequestActions();
  return (
    <QueueSlip
      to={`/jobs/${job.id}`}
      title={`${job.customer.name} · ${job.service}`}
      tone="bad"
      sub={`${KIND_LABEL[request.kind]} expired ${request.expiresAt ? timeAgo(request.expiresAt) : ''}`}
      right={<Money kobo={request.amountKobo} size="md" />}
      action={
        <div className="pd-actions" style={{ display: 'flex', gap: 6 }}>
          <Button
            variant="line"
            busy={a.resend.isPending && a.resend.variables === request.id}
            onClick={() => a.resend.mutate(request.id)}
          >
            Get new details
          </Button>
          {MOCK && (
            <Button
              variant="quiet"
              busy={a.simulate.isPending && a.simulate.variables === request.id}
              onClick={() => a.simulate.mutate(request.id)}
            >
              Late payment (demo)
            </Button>
          )}
        </div>
      }
    />
  );
}

export function ReminderRow({ request, job }: { request: PaymentRequest; job: JobSummary }) {
  const a = useRequestActions();
  return (
    <QueueSlip
      to={`/jobs/${job.id}`}
      title={`${job.customer.name} · ${job.service}`}
      tone="wait"
      sub={`Reminder due for ${KIND_LABEL[request.kind].toLowerCase()}`}
      right={<Money kobo={request.amountKobo} size="md" />}
      action={
        <Button
          variant="line"
          busy={a.send.isPending && a.send.variables === request.id}
          onClick={() => a.send.mutate(request.id)}
        >
          Get payment details
        </Button>
      }
    />
  );
}

export function ReviewRow({ item }: { item: ReviewItem }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <QueueSlip
        to={item.jobId ? `/jobs/${item.jobId}` : '/review'}
        title={REVIEW_LABEL[item.kind]}
        tone="bad"
        sub={item.message}
        action={
          <div className="pd-actions" style={{ display: 'flex', gap: 6 }}>
            {item.jobId && (
              <Link className="pd-btn pd-btn--line" to={`/jobs/${item.jobId}`}>
                <span>Open job</span>
              </Link>
            )}
            <Button onClick={() => setOpen(true)}>Resolve</Button>
          </div>
        }
      />
      <ResolveDialog item={item} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
