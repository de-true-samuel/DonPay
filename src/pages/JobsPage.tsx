import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { describeError } from '../api/errors';
import { jobsApi, queueApi } from '../api/endpoints';
import type { JobSummary } from '../contract/contract';
import type { JobWorkStatus } from '../contract/v2';
import { useDocumentTitle } from '../lib/hooks';
import { formatNaira } from '../lib/money';
import { formatDate } from '../lib/time';
import { Icon } from '../ui/Icon';
import { FlagChip, JobStatusChip, PaymentStatusChip } from '../ui/StatusChip';
import { Banner, Button, Skeleton } from '../ui/primitives';

type FilterChip = 'ALL' | JobWorkStatus;

function workStatusFor(j: JobSummary, queueWorkStatus?: JobWorkStatus): JobWorkStatus {
  if (j.status === 'CANCELLED') return 'cancelled';
  if (queueWorkStatus) return queueWorkStatus;
  if (j.readyToStart) return 'ready';
  return 'awaiting_payment';
}

function payStatusFor(j: JobSummary): 'awaiting_payment' | 'paid' | 'not_requested' | 'cancelled' {
  if (j.status === 'CANCELLED') return 'cancelled';
  if (BigInt(j.balanceKobo) <= 0n && BigInt(j.verifiedPaidKobo) > 0n) return 'paid';
  if (j.openRequest) return 'awaiting_payment';
  return 'not_requested';
}

export function JobsPage() {
  useDocumentTitle('Jobs');
  const [params, setParams] = useSearchParams();
  const statusFilter = (params.get('status') as FilterChip) || 'ALL';
  const [riskFilter, setRiskFilter] = useState<'none' | 'overdue' | 'at_risk'>('none');
  const [clientFilter, setClientFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'due' | 'newest' | 'amount'>('due');

  const q = useInfiniteQuery({
    queryKey: ['jobs', 'all'],
    queryFn: ({ pageParam }) => jobsApi.list({ limit: 50, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const { data: queue } = useQuery({
    queryKey: ['queue'],
    queryFn: () => queueApi.get(),
  });

  const queueMap = useMemo(() => {
    const map = new Map<string, { workStatus: JobWorkStatus; isOverdue: boolean; isAtRisk: boolean }>();
    if (!queue) return map;
    for (const item of [...queue.inProgress, ...queue.ready, ...queue.waitingForPayment]) {
      map.set(item.id, { workStatus: item.workStatus, isOverdue: item.isOverdue, isAtRisk: item.isAtRisk });
    }
    return map;
  }, [queue]);

  const rawItems = q.data?.pages.flatMap((p) => p.items) ?? [];

  const clients = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of rawItems) m.set(j.customer.id, j.customer.name);
    return [...m.entries()];
  }, [rawItems]);

  const enriched = useMemo(() => {
    return rawItems.map((j) => {
      const qInfo = queueMap.get(j.id);
      const ws = workStatusFor(j, qInfo?.workStatus);
      const ps = payStatusFor(j);
      const isOverdue = qInfo?.isOverdue ?? (!!j.balanceDueAt && Date.parse(j.balanceDueAt) < Date.now() && ws !== 'completed' && ws !== 'cancelled');
      const isAtRisk = qInfo?.isAtRisk ?? false;
      return { j, ws, ps, isOverdue, isAtRisk };
    });
  }, [rawItems, queueMap]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return enriched
      .filter(({ j, ws, isOverdue, isAtRisk }) => {
        if (statusFilter !== 'ALL' && ws !== statusFilter) return false;
        if (riskFilter === 'overdue' && !isOverdue) return false;
        if (riskFilter === 'at_risk' && !isAtRisk) return false;
        if (clientFilter && j.customer.id !== clientFilter) return false;
        if (s && !j.service.toLowerCase().includes(s) && !j.customer.name.toLowerCase().includes(s)) return false;
        return true;
      })
      .sort((a, b) => {
        if (sort === 'newest') return Date.parse(b.j.createdAt) - Date.parse(a.j.createdAt);
        if (sort === 'amount') return Number(BigInt(b.j.totalKobo) - BigInt(a.j.totalKobo));
        if (a.j.balanceDueAt && b.j.balanceDueAt) return Date.parse(a.j.balanceDueAt) - Date.parse(b.j.balanceDueAt);
        return a.j.balanceDueAt ? -1 : 1;
      });
  }, [enriched, statusFilter, riskFilter, clientFilter, search, sort]);

  function setStatus(next: FilterChip) {
    const sp = new URLSearchParams(params);
    if (next === 'ALL') sp.delete('status');
    else sp.set('status', next);
    setParams(sp);
  }

  const STATUS_CHIPS: { value: FilterChip; label: string }[] = [
    { value: 'ALL', label: 'All' },
    { value: 'awaiting_payment', label: 'Awaiting payment' },
    { value: 'ready', label: 'Ready' },
    { value: 'in_progress', label: 'In progress' },
    { value: 'completed', label: 'Completed' },
    { value: 'on_hold', label: 'On hold' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  return (
    <div data-flow-id="JBL-00">
      <div className="pf-page-head">
        <div>
          <h1>Jobs</h1>
          <p className="pf-page-head__sub">Track work from payment readiness to completion.</p>
        </div>
        <Link to="/app/new" className="pf-btn pf-btn--primary" data-flow-id="JBL-08">
          <Icon name="plus" size={16} />
          <span>New request</span>
        </Link>
      </div>

      {/* Filters & Search */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="search"
            className="pd-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search job or client…"
            aria-label="Search jobs"
            data-flow-id="JBL-01"
            style={{ flex: 1, minWidth: 220, maxWidth: 320, minHeight: 42 }}
          />

          <select
            aria-label="Filter by client"
            className="pd-input"
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            data-flow-id="JBL-04"
            style={{ width: 'auto', minHeight: 42, fontSize: 13 }}
          >
            <option value="">All clients</option>
            {clients.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>

          <select
            aria-label="Sort jobs"
            className="pd-input"
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            data-flow-id="JBL-05"
            style={{ width: 'auto', minHeight: 42, fontSize: 13 }}
          >
            <option value="due">Due date (soonest)</option>
            <option value="newest">Newest</option>
            <option value="amount">Amount high → low</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} data-flow-id="JBL-02">
          {STATUS_CHIPS.map((c) => {
            const active = statusFilter === c.value;
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => setStatus(c.value)}
                className={`pd-chip ${active ? 'is-on' : ''}`}
                style={{ minHeight: 38 }}
              >
                {c.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setRiskFilter(riskFilter === 'overdue' ? 'none' : 'overdue')}
            data-flow-id="JBL-03"
            className="pd-chip"
            style={{
              minHeight: 38,
              borderColor: riskFilter === 'overdue' ? 'var(--flare-bd)' : undefined,
              background: riskFilter === 'overdue' ? 'var(--flare-bg)' : undefined,
              color: riskFilter === 'overdue' ? 'var(--flare-ink)' : undefined,
            }}
          >
            Overdue
          </button>
          <button
            type="button"
            onClick={() => setRiskFilter(riskFilter === 'at_risk' ? 'none' : 'at_risk')}
            className="pd-chip"
            style={{
              minHeight: 38,
              borderColor: riskFilter === 'at_risk' ? 'var(--solar-bd)' : undefined,
              background: riskFilter === 'at_risk' ? 'var(--solar-bg)' : undefined,
              color: riskFilter === 'at_risk' ? 'var(--solar-ink)' : undefined,
            }}
          >
            At risk
          </button>
        </div>
      </div>

      {q.isPending && (
        <div className="pd-stack pd-gap" aria-busy="true">
          <Skeleton h={64} />
          <Skeleton h={64} />
        </div>
      )}

      {q.isError && (
        <Banner tone="bad" action={<Button variant="line" onClick={() => void q.refetch()}>Try again</Button>}>
          {describeError(q.error).message}
        </Banner>
      )}

      {q.data && filtered.length === 0 && (
        <div className="pf-card" style={{ textAlign: 'center', padding: 36 }}>
          {rawItems.length === 0 ? (
            <>
              <p style={{ color: 'var(--text-secondary)', marginBottom: 14 }}>No jobs yet. Create your first payment request.</p>
              <Link to="/app/new" className="pf-btn pf-btn--primary">Create payment request</Link>
            </>
          ) : (
            <>
              <p style={{ color: 'var(--text-secondary)', marginBottom: 14 }}>No jobs match.</p>
              <button type="button" className="pf-btn pf-btn--secondary" onClick={() => { setStatus('ALL'); setRiskFilter('none'); setClientFilter(''); setSearch(''); }}>
                Clear filters
              </button>
            </>
          )}
        </div>
      )}

      {filtered.length > 0 && (
        <>
          <div className="pf-card pf-table-wrap" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="pf-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Client</th>
                  <th style={{ textAlign: 'right' }}>Amount / Progress</th>
                  <th>Payment</th>
                  <th>Deadline</th>
                  <th>Work status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ j, ws, ps, isOverdue, isAtRisk }) => (
                  <tr key={j.id} data-flow-id="JBL-06">
                    <td>
                      <Link to={`/app/jobs/${j.id}`} style={{ fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>
                        {j.service}
                      </Link>
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        {isOverdue && <FlagChip flag="overdue" />}
                        {isAtRisk && <FlagChip flag="at_risk" />}
                      </div>
                    </td>
                    <td>
                      <Link to={`/app/clients/${j.customer.id}`} style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>
                        {j.customer.name}
                      </Link>
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      <div style={{ fontWeight: 600 }}>{formatNaira(j.totalKobo)}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {formatNaira(j.paidKobo)} paid
                      </div>
                    </td>
                    <td><PaymentStatusChip status={ps} /></td>
                    <td style={{ color: 'var(--text-secondary)' }}>{j.balanceDueAt ? formatDate(j.balanceDueAt) : '—'}</td>
                    <td><JobStatusChip status={ws} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pf-card-list">
            {filtered.map(({ j, ws, ps, isOverdue, isAtRisk }) => (
              <Link
                key={j.id}
                to={`/app/jobs/${j.id}`}
                className="pf-card"
                style={{ textDecoration: 'none', color: 'inherit', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <strong style={{ fontSize: 15 }}>{j.service}</strong>
                  <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{formatNaira(j.totalKobo)}</strong>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {j.customer.name} · {formatNaira(j.paidKobo)} paid
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <PaymentStatusChip status={ps} />
                  <JobStatusChip status={ws} />
                  {isOverdue && <FlagChip flag="overdue" />}
                  {isAtRisk && <FlagChip flag="at_risk" />}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      {q.hasNextPage && (
        <div style={{ marginTop: 16, textAlign: 'center' }} data-flow-id="JBL-09">
          <Button variant="line" busy={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Show more</Button>
        </div>
      )}
    </div>
  );
}
