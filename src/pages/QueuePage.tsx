import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queueApi } from '../api/endpoints';
import type { QueueJobItem } from '../contract/v2';
import { useDocumentTitle } from '../lib/hooks';
import { formatNaira } from '../lib/money';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { FlagChip, JobStatusChip } from '../ui/StatusChip';
import { useToast } from '../ui/Toast';

export function QueuePage() {
  useDocumentTitle('Next up · Queue');
  const [params, setParams] = useSearchParams();
  const riskOnly = params.get('filter') === 'risk';
  const [clientFilter, setClientFilter] = useState('');
  const [waitingOpen, setWaitingOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [capExplainOpen, setCapExplainOpen] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState<QueueJobItem | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideErr, setOverrideErr] = useState('');

  const qc = useQueryClient();
  const toast = useToast();

  const { data: queue, isLoading } = useQuery({
    queryKey: ['queue'],
    queryFn: () => queueApi.get(),
  });

  const approveMut = useMutation({
    mutationFn: ({ id, slotLabel }: { id: string; slotLabel: string }) =>
      queueApi.approveSchedule(id, slotLabel),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['queue'] });
      toast.success('Schedule window approved.');
    },
    onError: (err) => {
      toast.error((err as Error).message || 'Could not approve schedule.');
    },
  });

  const transitionMut = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: 'start' | 'complete' | 'hold' | 'resume' | 'override-ready'; reason?: string }) =>
      queueApi.transition(id, action, reason),
    onSuccess: (_res, vars) => {
      void qc.invalidateQueries({ queryKey: ['queue'] });
      void qc.invalidateQueries({ queryKey: ['today'] });
      if (vars.action === 'start') toast.success('Started. Good luck.');
      else if (vars.action === 'complete') toast.success('Marked completed.');
      else if (vars.action === 'hold') toast.info('Put on hold.');
      else if (vars.action === 'override-ready') toast.info('Marked ready without payment.');
      setOverrideTarget(null);
      setOverrideReason('');
      setOverrideErr('');
    },
    onError: (err) => {
      toast.error((err as Error).message || 'Could not update job.');
    },
  });

  const clients = useMemo(() => {
    if (!queue) return [];
    const map = new Map<string, string>();
    for (const item of [...queue.inProgress, ...queue.ready, ...queue.waitingForPayment]) {
      if (item.client.id) map.set(item.client.id, item.client.name);
    }
    return [...map.entries()];
  }, [queue]);

  const filterList = (items: QueueJobItem[]) =>
    items.filter((j) => {
      if (riskOnly && !j.isOverdue && !j.isAtRisk) return false;
      if (clientFilter && j.client.id !== clientFilter) return false;
      return true;
    });

  const inProgress = filterList(queue?.inProgress ?? []);
  const ready = filterList(queue?.ready ?? []);
  const waiting = filterList(queue?.waitingForPayment ?? []);

  const cap = queue?.capacity;
  const barColor = !cap
    ? 'var(--volt)'
    : cap.utilizationPercent > 100
      ? 'var(--flare)'
      : cap.utilizationPercent >= 90
        ? 'var(--solar)'
        : 'var(--volt)';

  function toggleRisk() {
    const next = new URLSearchParams(params);
    if (riskOnly) next.delete('filter');
    else next.set('filter', 'risk');
    setParams(next);
  }

  function submitOverride() {
    if (!overrideTarget) return;
    const clean = overrideReason.trim();
    if (clean.length < 5 || clean.length > 200) {
      setOverrideErr('Enter a reason between 5 and 200 characters.');
      return;
    }
    transitionMut.mutate({ id: overrideTarget.id, action: 'override-ready', reason: clean });
  }

  const renderCard = (item: QueueJobItem, kind: 'in_progress' | 'ready' | 'waiting') => (
    <div
      key={item.id}
      className="pf-card"
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: 16 }}
      data-flow-id="QUE-06"
    >
      <div style={{ minWidth: 220, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
          {item.rank !== null && (
            <span className="pd-mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
              #{item.rank}
            </span>
          )}
          <Link to={`/app/jobs/${item.id}`} style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)', textDecoration: 'none' }}>
            {item.title}
          </Link>
          <JobStatusChip status={item.workStatus} />
          {item.isOverdue && <FlagChip flag="overdue" />}
          {item.isAtRisk && <FlagChip flag="at_risk" />}
          {item.depositPaid && <FlagChip flag="deposit_paid" />}
          {item.startedWithoutPayment && <FlagChip flag="started_without_payment" />}
          {typeof item.priorityScore === 'number' && (
            <span className="pd-mono" style={{ fontSize: 11.5, padding: '2px 7px', borderRadius: 6, background: 'var(--bg-2)', border: '1px solid var(--line-1)', color: 'var(--ink-2)' }}>
              Score {item.priorityScore}
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>{item.client.name}</span>
          <span>·</span>
          <span>{item.reasonLabel}</span>
          <span>·</span>
          <strong style={{ color: 'var(--text-primary)' }}>{formatNaira(item.totalKobo)}</strong>
          {item.recommendedSlot && (
            <>
              <span>·</span>
              <span style={{ color: item.recommendedSlot.hasConflict ? 'var(--flare-ink)' : 'var(--mint)' }}>
                {item.scheduleApproved
                  ? `Scheduled: ${item.approvedSlotLabel ?? item.recommendedSlot.dayLabel}`
                  : item.recommendedSlot.hasConflict
                    ? `Conflict · ${item.recommendedSlot.dayLabel}`
                    : `Suggested: ${item.recommendedSlot.dayLabel}`}
              </span>
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {kind !== 'waiting' && item.recommendedSlot && !item.scheduleApproved && !item.recommendedSlot.hasConflict && (
          <button
            type="button"
            className="pf-btn pf-btn--sm pf-btn--secondary"
            disabled={approveMut.isPending}
            onClick={() => approveMut.mutate({ id: item.id, slotLabel: item.recommendedSlot!.dayLabel })}
          >
            Approve schedule
          </button>
        )}
        {kind === 'ready' && (
          <button
            type="button"
            className="pf-btn pf-btn--sm pf-btn--primary"
            disabled={transitionMut.isPending}
            onClick={() => transitionMut.mutate({ id: item.id, action: 'start' })}
            data-flow-id="QUE-07"
          >
            Start
          </button>
        )}
        {kind === 'in_progress' && (
          <button
            type="button"
            className="pf-btn pf-btn--sm pf-btn--primary"
            disabled={transitionMut.isPending}
            onClick={() => transitionMut.mutate({ id: item.id, action: 'complete' })}
            data-flow-id="QUE-08"
          >
            Mark completed
          </button>
        )}
        {kind !== 'waiting' && (
          <button
            type="button"
            className="pf-btn pf-btn--sm pf-btn--secondary"
            disabled={transitionMut.isPending}
            onClick={() => transitionMut.mutate({ id: item.id, action: 'hold' })}
            data-flow-id="QUE-09"
          >
            Hold
          </button>
        )}
        {kind === 'waiting' && (
          <button
            type="button"
            className="pf-btn pf-btn--sm pf-btn--secondary"
            onClick={() => { setOverrideTarget(item); setOverrideReason(''); setOverrideErr(''); }}
          >
            Mark ready anyway
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div data-flow-id="QUE-00">
      <div className="pf-page-head">
        <div>
          <h1>Next up</h1>
          <p className="pf-page-head__sub">A clear view of what to work on next. Paidar suggests; you decide.</p>
        </div>
        <div className="pf-page-head__actions">
          <button
            type="button"
            className="pf-btn pf-btn--sm pf-btn--secondary"
            onClick={() => setWhyOpen((v) => !v)}
            data-flow-id="QUE-02"
          >
            <Icon name="info" size={16} />
            <span>Why this order?</span>
          </button>
          <button
            type="button"
            className={`pf-btn pf-btn--sm ${riskOnly ? 'pf-btn--primary' : 'pf-btn--secondary'}`}
            onClick={toggleRisk}
            data-flow-id="QUE-12"
          >
            <Icon name="alert" size={15} />
            <span>At risk / Overdue</span>
          </button>
          <select
            aria-label="Filter by client"
            className="pd-input"
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            data-flow-id="QUE-11"
            style={{ width: 'auto', minHeight: 40, fontSize: 13 }}
          >
            <option value="">All clients</option>
            {clients.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Why this order popover/card */}
      {whyOpen && (
        <div className="pf-card" style={{ marginBottom: 16, background: 'var(--bg-2)', borderColor: 'var(--line-2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong>How Paidar orders your queue</strong>
            <button type="button" onClick={() => setWhyOpen(false)} style={{ border: 0, background: 'transparent', cursor: 'pointer' }}>
              <Icon name="x" size={16} />
            </button>
          </div>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, color: 'var(--text-primary)', lineHeight: '22px' }}>
            <li><strong>Rules-based priority score</strong>: 35% deadline urgency, 25% payment readiness, 15% client priority, 15% duration fit, and 10% dependency readiness.</li>
            <li><strong>In progress</strong> and overdue or at-risk jobs surface at the top so urgent paid work never slips.</li>
            <li><strong>Recommended schedule windows</strong> allocate active jobs into your configured working hours, flagging conflicts instead of inventing impossible slots.</li>
            <li><strong>Waiting for payment</strong> jobs stay collapsed until payment is verified or you record a payment-override reason.</li>
          </ol>
        </div>
      )}

      {/* Capacity Strip (QUE-01) */}
      {cap && (
        <div className="pf-capacity" onClick={() => setCapExplainOpen((v) => !v)} data-flow-id="QUE-01">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>
              This week: {cap.committedHours}h committed of {cap.availableHours}h available
            </span>
            <span style={{
              fontSize: 13, fontWeight: 600,
              color: cap.overByHours > 0 ? 'var(--status-danger)' : cap.utilizationPercent >= 90 ? 'var(--status-warning)' : 'var(--text-secondary)',
            }}>
              {cap.overByHours > 0 ? `Over by ${cap.overByHours}h` : `${cap.utilizationPercent}% capacity`}
            </span>
          </div>
          <div className="pf-capacity__bar">
            <div className="pf-capacity__fill" style={{ width: `${Math.min(100, cap.utilizationPercent)}%`, background: barColor }} />
          </div>
          {capExplainOpen && (
            <p style={{ marginTop: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
              Calculated from estimated hours on active jobs due this week against your{' '}
              <Link to="/app/settings" onClick={(e) => e.stopPropagation()}>working hours settings</Link>. Paidar never books time automatically.
            </p>
          )}
        </div>
      )}

      {isLoading && <div className="pf-card"><p style={{ color: 'var(--text-secondary)' }}>Loading work queue…</p></div>}

      {!isLoading && inProgress.length === 0 && ready.length === 0 && (
        <div className="pf-card" style={{ textAlign: 'center', padding: 36 }} data-flow-id="QUE-15">
          <h2 style={{ marginBottom: 6 }}>Nothing ready yet</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
            Nothing ready. When a client pays, their job appears here.
          </p>
          <Link to="/app/new" className="pf-btn pf-btn--primary">Create a payment request</Link>
        </div>
      )}

      {inProgress.length > 0 && (
        <section style={{ marginBottom: 24 }} data-flow-id="QUE-03">
          <h2 style={{ fontSize: 14, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>
            In progress ({inProgress.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {inProgress.map((j) => renderCard(j, 'in_progress'))}
          </div>
        </section>
      )}

      {ready.length > 0 && (
        <section style={{ marginBottom: 24 }} data-flow-id="QUE-04">
          <h2 style={{ fontSize: 14, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>
            Ready to start ({ready.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {ready.map((j) => renderCard(j, 'ready'))}
          </div>
        </section>
      )}

      {waiting.length > 0 && (
        <section data-flow-id="QUE-05">
          <button
            type="button"
            onClick={() => setWaitingOpen((v) => !v)}
            style={{
              width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 16px', borderRadius: 12, border: '1px solid var(--border-default)',
              background: 'var(--bg-surface)', cursor: 'pointer', fontWeight: 600, fontSize: 14,
            }}
          >
            <span>Waiting for payment ({waiting.length})</span>
            <Icon name="chevron" size={18} />
          </button>
          {waitingOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
              {waiting.map((j) => renderCard(j, 'waiting'))}
            </div>
          )}
        </section>
      )}

      {/* Focus-trapped native Dialog for Owner Override (§4.10) */}
      <Dialog open={!!overrideTarget} onClose={() => setOverrideTarget(null)} title="Mark ready anyway?">
        {overrideTarget && (
          <>
            <p className="pd-lede">
              You’re starting <strong>{overrideTarget.title}</strong> before payment is verified. This is recorded in the job timeline with a “Started without payment” tag.
            </p>
            <div className="pd-field">
              <label htmlFor="override-reason" className="pd-label">Reason (5–200 characters)</label>
              <input
                id="override-reason"
                type="text"
                className={`pd-input ${overrideErr ? 'pd-input--bad' : ''}`}
                value={overrideReason}
                onChange={(e) => { setOverrideReason(e.target.value); setOverrideErr(''); }}
                placeholder="e.g. Trusted repeat client, paying on Friday"
              />
              {overrideErr && <p className="pd-error" role="alert">{overrideErr}</p>}
            </div>
            <div className="pd-actions" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="pf-btn pf-btn--secondary" onClick={() => setOverrideTarget(null)}>Cancel</button>
              <button type="button" className="pf-btn pf-btn--primary" disabled={transitionMut.isPending} onClick={submitOverride}>
                {transitionMut.isPending ? 'Saving…' : 'Mark as ready'}
              </button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}
