import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { JobSummary, Payment, PaymentRequest, ReviewItem } from '../../contract/contract';
import { MOCK } from '../../config';
import { REVIEW_LABEL } from '../../lib/review';
import { ResolveDialog } from '../review/ResolveDialog';
import { cls } from '../../lib/cls';
import { formatDate, timeAgo } from '../../lib/time';
import { Money } from '../../ui/Money';
import { Button } from '../../ui/primitives';
import { ReadyBadge, StatusPill, TrustBadge } from '../../ui/Trust';
import { TicketCard } from '../../ui/TicketCard';
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
            onClick={() => a.receipt.mutate({ paymentId: payment.id, customerName: job.customer.name })}>Send receipt</Button>
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
        onClick={() => a.balance.mutate(job.id)}>Request balance</Button>} />
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
            onClick={() => a.resend.mutate(request.id)}>Send again</Button>
          {MOCK && <Button variant="quiet" busy={a.simulate.isPending && a.simulate.variables === request.id}
            onClick={() => a.simulate.mutate(request.id)}>Late payment (demo)</Button>}
        </div>
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
