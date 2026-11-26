import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiRequestError } from '../api/client';
import { describeError } from '../api/errors';
import { jobsApi, queueApi } from '../api/endpoints';
import { CancelJobDialog, ManualPaymentDialog } from '../features/jobs/JobDialogs';
import { JobTimeline } from '../features/jobs/JobTimeline';
import { RequestCard } from '../features/requests/RequestCard';
import { useRequestActions } from '../features/requests/useRequestActions';
import { useDocumentTitle } from '../lib/hooks';
import { formatDate } from '../lib/time';
import { buildJobTimeline } from '../lib/timeline';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { Money } from '../ui/Money';
import { Banner, Button, EmptyState, Skeleton } from '../ui/primitives';
import { FlagChip, JobStatusChip, PaymentStatusChip } from '../ui/StatusChip';
import { useToast } from '../ui/Toast';

type TabKey = 'overview' | 'payments' | 'activity';

export function JobPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const toast = useToast();
  const a = useRequestActions();

  const initialTab: TabKey =
    loc.hash === '#payments' ? 'payments' : loc.hash === '#activity' ? 'activity' : 'overview';
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [activityFilter, setActivityFilter] = useState<'all' | 'payments' | 'edits'>('all');

  const q = useQuery({
    queryKey: ['job', id],
    queryFn: () => jobsApi.get(id),
    refetchInterval: (query) => (query.state.data?.openRequest?.status === 'SENT' ? 10_000 : false),
  });

  const { data: queue } = useQuery({
    queryKey: ['queue'],
    queryFn: () => queueApi.get(),
  });

  const transitionMut = useMutation({
    mutationFn: ({ action, reason }: { action: 'start' | 'complete' | 'hold' | 'resume' | 'override-ready'; reason?: string }) =>
      queueApi.transition(id, action, reason),
    onSuccess: (_res, vars) => {
      void qc.invalidateQueries({ queryKey: ['job', id] });
      void qc.invalidateQueries({ queryKey: ['queue'] });
      void qc.invalidateQueries({ queryKey: ['today'] });
      toast.success(`Job updated (${vars.action}).`);
      setOverrideOpen(false);
      setOverrideReason('');
    },
    onError: (err) => toast.error((err as Error).message || 'Could not update job.'),
  });

  const items = useMemo(() => (q.data ? buildJobTimeline(q.data) : []), [q.data]);
  useDocumentTitle(q.data ? `${q.data.service} · ${q.data.customer.name}` : 'Job');

  if (q.isPending) {
    return (
      <div className="pd-stack" aria-busy="true">
        <Skeleton h={34} w="55%" />
        <Skeleton h={60} />
        <Skeleton h={140} />
      </div>
    );
  }

  if (q.isError || !q.data) {
    const missing = q.error instanceof ApiRequestError && q.error.status === 404;
    return missing ? (
      <EmptyState
        title="That job doesn’t exist."
        action={<Link to="/app/jobs" className="pf-btn pf-btn--secondary">Back to Jobs</Link>}
      >
        It may have been removed.
      </EmptyState>
    ) : (
      <Banner tone="bad" action={<Button variant="line" onClick={() => void q.refetch()}>Try again</Button>}>
        {describeError(q.error).message}
      </Banner>
    );
  }

  const j = q.data;
  const open = j.openRequest;
  const cancelled = j.status === 'CANCELLED';
  const qItem = queue ? [...queue.inProgress, ...queue.ready, ...queue.waitingForPayment].find((x) => x.id === j.id) : undefined;
  const workStatus = cancelled ? 'cancelled' : (qItem?.workStatus ?? (j.readyToStart ? 'ready' : 'awaiting_payment'));
  const payStatus = cancelled ? 'cancelled' : BigInt(j.balanceKobo) <= 0n && BigInt(j.verifiedPaidKobo) > 0n ? 'paid' : open ? 'awaiting_payment' : 'not_requested';
  const total = BigInt(j.totalKobo);
  const pct = total > 0n ? Math.min(100, Math.max(0, Number((BigInt(j.paidKobo) * 10000n) / total) / 100)) : 0;

  function switchTab(next: TabKey) {
    setTab(next);
    nav(`${loc.pathname}#${next}`, { replace: true });
  }

  const duplicateUrl = `/app/new?customerId=${j.customer.id}&service=${encodeURIComponent(j.service)}&plan=${j.plan}&total=${j.totalKobo}${j.depositKobo ? `&deposit=${j.depositKobo}` : ''}`;

  return (
    <div style={{ maxWidth: 760, display: 'grid', gap: 20 }} data-flow-id="JBD-00">
      <div>
        <Link to="/app/jobs" data-flow-id="JBD-01" className="pd-back">
          <Icon name="chevron" size={16} />
          <span>Back to Jobs</span>
        </Link>

        {/* Header */}
        <header className="pf-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 data-flow-id="JBD-02" style={{ fontSize: 24 }}>{j.service}</h1>
              <div style={{ marginTop: 4, fontSize: 14, color: 'var(--ink-2)' }}>
                Client: <Link to={`/app/clients/${j.customer.id}`} data-flow-id="JBD-03" style={{ fontWeight: 600 }}>{j.customer.name}</Link>
                {j.balanceDueAt && <> · Due <span className="pd-mono">{formatDate(j.balanceDueAt)}</span></>}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} data-flow-id="JBD-04">
              <JobStatusChip status={workStatus} />
              <PaymentStatusChip status={payStatus} />
              {qItem?.isOverdue && <FlagChip flag="overdue" />}
              {qItem?.isAtRisk && <FlagChip flag="at_risk" />}
              {qItem?.startedWithoutPayment && <FlagChip flag="started_without_payment" />}
            </div>
          </div>

          {/* 3-Part Financial Strip & Progress (§6.6) */}
          <div data-flow-id="JBD-06" style={{ display: 'grid', gap: 12, paddingTop: 12, borderTop: '1px solid var(--line-1)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
              <div>
                <div className="ob-overline">Total price</div>
                <Money kobo={j.totalKobo} size="md" />
              </div>
              <div>
                <div className="ob-overline">Paid to date</div>
                <Money kobo={j.paidKobo} size="md" tone={BigInt(j.verifiedPaidKobo) > 0n ? 'mint' : 'default'} />
              </div>
              <div>
                <div className="ob-overline">Balance left</div>
                <Money kobo={j.balanceKobo} size="md" tone={qItem?.isOverdue && BigInt(j.balanceKobo) > 0n ? 'flare' : 'default'} />
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 6 }}>
                <span>Payment progress</span>
                <span className="pd-mono">{pct.toFixed(0)}%</span>
              </div>
              <div className="pd-progress">
                <i style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>

          {/* Primary Action Matrix (JBD-07) */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4 }} data-flow-id="JBD-07">
            {workStatus === 'awaiting_payment' && open && (
              <button type="button" className="pf-btn pf-btn--primary" onClick={() => a.send.mutate(open.id)}>
                Share payment link
              </button>
            )}
            {workStatus === 'ready' && (
              <button type="button" className="pf-btn pf-btn--primary" onClick={() => transitionMut.mutate({ action: 'start' })}>
                Start job
              </button>
            )}
            {workStatus === 'in_progress' && (
              <button type="button" className="pf-btn pf-btn--primary" onClick={() => transitionMut.mutate({ action: 'complete' })}>
                Mark completed
              </button>
            )}
            {workStatus === 'on_hold' && (
              <button type="button" className="pf-btn pf-btn--primary" onClick={() => transitionMut.mutate({ action: 'resume' })}>
                Resume
              </button>
            )}
            {(workStatus === 'completed' || workStatus === 'cancelled') && (
              <Link to={duplicateUrl} className="pf-btn pf-btn--primary">Duplicate job</Link>
            )}

            {!cancelled && BigInt(j.balanceKobo) > 0n && (
              <button type="button" className="pf-btn pf-btn--secondary" onClick={() => setManualOpen(true)}>
                Record cash payment
              </button>
            )}
            {workStatus === 'awaiting_payment' && (
              <button type="button" className="pf-btn pf-btn--secondary" onClick={() => setOverrideOpen(true)}>
                Mark ready anyway
              </button>
            )}
            {(workStatus === 'ready' || workStatus === 'in_progress') && (
              <button type="button" className="pf-btn pf-btn--secondary" onClick={() => transitionMut.mutate({ action: 'hold' })}>
                Hold
              </button>
            )}
            {!cancelled && (
              <Link to={`/app/jobs/${j.id}/edit`} className="pf-btn pf-btn--secondary">Edit job</Link>
            )}
            {!cancelled && (
              <button type="button" className="pf-btn pf-btn--danger" onClick={() => setCancelOpen(true)}>
                Cancel job
              </button>
            )}
          </div>
        </header>
      </div>

      {/* 3 Tabs: Overview / Payments / Activity (JBD-09) */}
      <div className="pf-tabs" role="tablist" data-flow-id="JBD-09">
        <button type="button" role="tab" aria-selected={tab === 'overview'} className={`pf-tab-btn ${tab === 'overview' ? 'is-active' : ''}`} onClick={() => switchTab('overview')}>
          Overview
        </button>
        <button type="button" role="tab" aria-selected={tab === 'payments'} className={`pf-tab-btn ${tab === 'payments' ? 'is-active' : ''}`} onClick={() => switchTab('payments')}>
          Payments ({j.requests.length})
        </button>
        <button type="button" role="tab" aria-selected={tab === 'activity'} className={`pf-tab-btn ${tab === 'activity' ? 'is-active' : ''}`} onClick={() => switchTab('activity')}>
          Activity
        </button>
      </div>

      {tab === 'overview' && (
        <section className="pf-card" style={{ display: 'grid', gap: 16 }}>
          <div>
            <div className="ob-overline" style={{ marginBottom: 4 }}>Description</div>
            <p data-flow-id="JBD-10" style={{ color: 'var(--ink-1)' }}>{j.service}</p>
          </div>
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 10, margin: 0, fontSize: 13.5 }} data-flow-id="JBD-11">
            <dt style={{ color: 'var(--ink-3)' }}>Payment plan</dt>
            <dd style={{ margin: 0, color: 'var(--ink-1)' }}>{j.plan === 'DEPOSIT_BALANCE' ? 'Deposit + balance' : 'Full payment'}</dd>
            <dt style={{ color: 'var(--ink-3)' }}>Balance remaining</dt>
            <dd style={{ margin: 0 }}><Money kobo={j.balanceKobo} size="sm" /></dd>
            <dt style={{ color: 'var(--ink-3)' }}>Created</dt>
            <dd className="pd-mono" style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-2)' }}>{formatDate(j.createdAt)}</dd>
            <dt style={{ color: 'var(--ink-3)' }}>Job ID</dt>
            <dd className="pd-mono" style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)' }}>{j.id}</dd>
          </dl>
          {j.notes && (
            <div className="pd-note" data-flow-id="JBD-12">
              <div className="ob-overline" style={{ marginBottom: 4 }}>Private notes</div>
              <p style={{ fontSize: 13.5 }}>{j.notes}</p>
            </div>
          )}
          <div style={{ borderTop: '1px solid var(--line-1)', paddingTop: 12, display: 'flex', gap: 10 }} data-flow-id="JBD-13">
            <a href={`https://wa.me/${j.customer.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="pf-btn pf-btn--sm pf-btn--secondary">
              <Icon name="send" size={15} />
              <span>Message on WhatsApp</span>
            </a>
            <a href={`tel:${j.customer.phone}`} className="pf-btn pf-btn--sm pf-btn--secondary">Call client</a>
          </div>
        </section>
      )}

      {tab === 'payments' && (
        <section style={{ display: 'grid', gap: 14 }}>
          {j.requests.length === 0 ? (
            <div className="pf-card"><p style={{ color: 'var(--ink-2)' }}>No payment requests yet.</p></div>
          ) : (
            j.requests.map((r) => (
              <RequestCard key={r.id} request={r} job={j} hero={r.id === open?.id && (r.status === 'SENT' || r.status === 'PAID')} />
            ))
          )}
        </section>
      )}

      {tab === 'activity' && (
        <section className="pf-card" data-flow-id="JBD-26">
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }} data-flow-id="JBD-27">
            {(['all', 'payments', 'edits'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`pf-btn pf-btn--sm ${activityFilter === f ? 'pf-btn--primary' : 'pf-btn--secondary'}`}
                onClick={() => setActivityFilter(f)}
              >
                {f === 'all' ? 'All' : f === 'payments' ? 'Payments' : 'Status / Edits'}
              </button>
            ))}
          </div>
          <JobTimeline
            items={items}
            onReceipt={(paymentId) => a.receipt.mutate({ paymentId, customerName: j.customer.name })}
            receiptBusy={a.receipt.isPending ? a.receipt.variables?.paymentId : undefined}
          />
        </section>
      )}

      {/* Focus-trapped native Dialog for Mark Ready Anyway (§4.10) */}
      <Dialog open={overrideOpen} onClose={() => setOverrideOpen(false)} title="Mark ready anyway?">
        <p className="pd-lede">
          You’re starting before payment is verified. This is logged and tagged “Started without payment”.
        </p>
        <input
          type="text"
          className="pd-input"
          value={overrideReason}
          onChange={(e) => setOverrideReason(e.target.value)}
          placeholder="Reason (5–200 chars)"
        />
        <div className="pd-actions" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="pf-btn pf-btn--secondary" onClick={() => setOverrideOpen(false)}>Cancel</button>
          <button type="button" className="pf-btn pf-btn--primary" onClick={() => transitionMut.mutate({ action: 'override-ready', reason: overrideReason })}>
            Confirm
          </button>
        </div>
      </Dialog>

      <ManualPaymentDialog job={j} open={manualOpen} onClose={() => setManualOpen(false)} />
      <CancelJobDialog job={j} open={cancelOpen} onClose={() => setCancelOpen(false)} />
    </div>
  );
}
