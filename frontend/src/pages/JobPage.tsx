import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ApiRequestError } from '../api/client';
import { describeError } from '../api/errors';
import { jobsApi } from '../api/endpoints';
import { CancelJobDialog, EditJobDialog, ManualPaymentDialog } from '../features/jobs/JobDialogs';
import { JobTimeline } from '../features/jobs/JobTimeline';
import { RequestCard } from '../features/requests/RequestCard';
import { useRequestActions } from '../features/requests/useRequestActions';
import { useDocumentTitle } from '../lib/hooks';
import { formatNaira } from '../lib/money';
import { formatDate } from '../lib/time';
import { buildJobTimeline } from '../lib/timeline';
import { Icon } from '../ui/Icon';
import { Money } from '../ui/Money';
import { Banner, Button, EmptyState, LinkButton, Skeleton } from '../ui/primitives';
import { JobStatusPill, ReadyBadge } from '../ui/Trust';

type Dlg = 'edit' | 'manual' | 'cancel' | null;

export function JobPage() {
  const { id = '' } = useParams();
  const a = useRequestActions();
  const [dlg, setDlg] = useState<Dlg>(null);
  const q = useQuery({
    queryKey: ['job', id],
    queryFn: () => jobsApi.get(id),
    refetchInterval: (query) => (query.state.data?.openRequest?.status === 'SENT' ? 10_000 : false),
  });
  const items = useMemo(() => (q.data ? buildJobTimeline(q.data) : []), [q.data]);
  useDocumentTitle(q.data ? q.data.customer.name : 'Job');

  if (q.isPending) return <div className="pd-stack" aria-busy="true"><Skeleton h={34} w="55%" /><Skeleton h={60} /><Skeleton h={140} /></div>;
  if (q.isError || !q.data) {
    const missing = q.error instanceof ApiRequestError && q.error.status === 404;
    return missing
      ? <EmptyState title="That job isn’t here" action={<LinkButton to="/jobs" variant="line">Back to Jobs</LinkButton>}>It may have been removed.</EmptyState>
      : <Banner tone="bad" action={<Button variant="line" onClick={() => void q.refetch()}>Try again</Button>}>{describeError(q.error).message}</Banner>;
  }

  const j = q.data;
  const open = j.openRequest;
  const cancelled = j.status === 'CANCELLED';
  const total = BigInt(j.totalKobo);
  const pct = total > 0n ? Math.min(100, Math.max(0, Number((BigInt(j.paidKobo) * 10000n) / total) / 100)) : 0;
  const owed = BigInt(j.balanceKobo) > 0n;
  const over = BigInt(j.balanceKobo) < 0n;

  return (
    <div className="pd-stack">
      <div>
        <Link to="/jobs" className="pd-back"><Icon name="chevron" size={16} />Jobs</Link>
        <header className="pd-jobhead">
          <h1><Link to={`/people/${j.customer.id}`} className="pd-plainlink">{j.customer.name}</Link></h1>
          <p className="pd-sub">{j.service}</p>
          {j.notes && <p className="pd-note">{j.notes}</p>}
          <div className="pd-actions"><JobStatusPill status={j.status} />{j.readyToStart && <ReadyBadge />}</div>
          {!cancelled && (
            <div className="pd-actions">
              <Button variant="line" icon="pencil" onClick={() => setDlg('edit')}>Edit</Button>
              <Button variant="line" onClick={() => setDlg('manual')}>Record a payment</Button>
            </div>
          )}
        </header>
      </div>

      <section className="pd-section" aria-label="Payment progress">
        <p className="pd-sumline"><Money kobo={j.paidKobo} size="xl" /> <span>paid of {formatNaira(j.totalKobo)}</span></p>
        <div className="pd-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}
          aria-label="Share of the total paid"><i style={{ width: `${pct}%` }} /></div>
        <p className="pd-hint">
          {over ? `Overpaid by ${formatNaira((-BigInt(j.balanceKobo)).toString())}`
            : owed ? `${formatNaira(j.balanceKobo)} still to pay${j.balanceDueAt ? ` · due ${formatDate(j.balanceDueAt)}` : ''}` : 'Nothing left to pay.'}
        </p>
        {j.hasUnverifiedPayments && <p className="pd-hint">Includes payments you entered by hand (not verified by Kora).</p>}
      </section>

      <section className="pd-section" aria-labelledby="j-req">
        <h2 id="j-req">{open ? 'Open request' : 'Next payment'}</h2>
        {open && <RequestCard request={open} job={j} />}
        {!open && cancelled && <Banner>This job is cancelled.</Banner>}
        {!open && !cancelled && owed && (
          <>
            <p className="pd-lede">No request is open. {formatNaira(j.balanceKobo)} is still owed.</p>
            <div><Button busy={a.balance.isPending} onClick={() => a.balance.mutate(j.id)}>Request balance</Button></div>
          </>
        )}
        {!open && !cancelled && !owed && <p className="pd-lede">Fully paid. Nothing to request.</p>}
      </section>

      <section className="pd-section" aria-labelledby="j-tl">
        <h2 id="j-tl">Timeline</h2>
        <JobTimeline items={items} receiptBusy={a.receipt.isPending ? a.receipt.variables?.paymentId : undefined}
          onReceipt={(paymentId) => a.receipt.mutate({ paymentId, customerName: j.customer.name })} />
      </section>

      {!cancelled && (
        <section className="pd-section pd-danger" aria-labelledby="j-danger">
          <h2 id="j-danger">Cancel this job</h2>
          <p className="pd-hint">Use this if the work won’t go ahead. Payments already received stay on record.</p>
          <div><Button variant="danger" onClick={() => setDlg('cancel')}>Cancel job</Button></div>
        </section>
      )}

      <EditJobDialog job={j} open={dlg === 'edit'} onClose={() => setDlg(null)} />
      <ManualPaymentDialog job={j} open={dlg === 'manual'} onClose={() => setDlg(null)} />
      <CancelJobDialog job={j} open={dlg === 'cancel'} onClose={() => setDlg(null)} />
    </div>
  );
}
