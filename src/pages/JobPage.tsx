import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiRequestError } from '../api/client';
import { describeError } from '../api/errors';
import { jobsApi, queueApi } from '../api/endpoints';
import { CancelJobDialog } from '../features/jobs/JobDialogs';
import { JobTimeline } from '../features/jobs/JobTimeline';
import { RequestCard } from '../features/requests/RequestCard';
import { useRequestActions } from '../features/requests/useRequestActions';
import { useDocumentTitle } from '../lib/hooks';
import { formatNaira } from '../lib/money';
import { formatDate } from '../lib/time';
import { buildJobTimeline } from '../lib/timeline';
import { Icon } from '../ui/Icon';
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
        <Link to="/app/jobs" data-flow-id="JBD-01" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13.5, color: 'var(--text-secondary)', textDecoration: 'none', marginBottom: 10 }}>
          <span>← Back to Jobs</span>
        </Link>

        {/* Header */}
        <header className="pf-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 data-flow-id="JBD-02" style={{ fontSize: 24 }}>{j.service}</h1>
              <div style={{ marginTop: 4, fontSize: 14, color: 'var(--text-secondary)' }}>
                Client: <Link to={`/app/clients/${j.customer.id}`} data-flow-id="JBD-03" style={{ fontWeight: 600 }}>{j.customer.name}</Link>
                {j.balanceDueAt && <> · Due {formatDate(j.balanceDueAt)}</>}
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

          {/* Payment Progress (JBD-06) */}
          <div data-flow-id="JBD-06">
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, marginBottom: 6 }}>
              <span><strong>{formatNaira(j.paidKobo)}</strong> paid of {formatNaira(j.totalKobo)}</span>
              <span style={{ color: 'var(--text-secondary)' }}>{pct.toFixed(0)}%</span>
            </div>
            <div style={{ height: 8, background: 'var(--bg-surface-subtle)', borderRadius: 999, overflow: 'hidden', border: '1px solid var(--border-default)' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: 'var(--status-success)' }} />
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
              <button type="button" className="pf-btn pf-btn--secondary" style={{ color: 'var(--status-danger)' }} onClick={() => setCancelOpen(true)}>
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
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Description</div>
            <p data-flow-id="JBD-10">{j.service}</p>
          </div>
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 10, margin: 0, fontSize: 13.5 }} data-flow-id="JBD-11">
            <dt style={{ color: 'var(--text-secondary)' }}>Payment plan</dt>
            <dd style={{ margin: 0 }}>{j.plan === 'DEPOSIT_BALANCE' ? 'Deposit + balance' : 'Full payment'}</dd>
            <dt style={{ color: 'var(--text-secondary)' }}>Balance remaining</dt>
            <dd style={{ margin: 0, fontWeight: 600 }}>{formatNaira(j.balanceKobo)}</dd>
            <dt style={{ color: 'var(--text-secondary)' }}>Created</dt>
            <dd style={{ margin: 0 }}>{formatDate(j.createdAt)}</dd>
            <dt style={{ color: 'var(--text-secondary)' }}>Job ID</dt>
            <dd className="pd-mono" style={{ margin: 0, fontSize: 12 }}>{j.id}</dd>
          </dl>
          {j.notes && (
            <div style={{ background: 'var(--bg-surface-subtle)', padding: 12, borderRadius: 9 }} data-flow-id="JBD-12">
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Private notes</div>
              <p style={{ fontSize: 13.5 }}>{j.notes}</p>
            </div>
          )}
          <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: 12, display: 'flex', gap: 10 }} data-flow-id="JBD-13">
            <a href={`https://wa.me/${j.customer.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="pf-btn pf-btn--sm pf-btn--secondary">
              <Icon name="send" size={15} />
              <span>Message on WhatsApp</span>
            </a>
            <a href={`tel:${j.customer.phone}`} className="pf-btn pf-btn--sm pf-btn--secondary">Call client</a>
          </div>
        </section>
      )}

      {tab === 'payments' && (
        <section style={{ display: 'grid', gap: 12 }}>
          {j.requests.length === 0 ? (
            <div className="pf-card"><p style={{ color: 'var(--text-secondary)' }}>No payment requests yet.</p></div>
          ) : (
            j.requests.map((r) => <RequestCard key={r.id} request={r} job={j} />)
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

      {/* Mark Ready Anyway Dialog */}
      {overrideOpen && (
        <div className="pf-sheet-backdrop" style={{ alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setOverrideOpen(false)}>
          <div role="dialog" aria-modal="true" className="pf-card" style={{ maxWidth: 440, width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: 6 }}>Mark ready anyway?</h2>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 12 }}>
              You’re starting before payment is verified. This is logged and tagged “Started without payment”.
            </p>
            <input
              type="text"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Reason (5–200 chars)"
              style={{ width: '100%', height: 44, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border-strong)', marginBottom: 12 }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="pf-btn pf-btn--secondary" onClick={() => setOverrideOpen(false)}>Cancel</button>
              <button type="button" className="pf-btn pf-btn--primary" onClick={() => transitionMut.mutate({ action: 'override-ready', reason: overrideReason })}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      <CancelJobDialog job={j} open={cancelOpen} onClose={() => setCancelOpen(false)} />
    </div>
  );
}
