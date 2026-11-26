import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { queueApi, todayApi } from '../api/endpoints';
import { useDocumentTitle } from '../lib/hooks';
import { formatTime } from '../lib/time';
import { CopyChip } from '../ui/CopyChip';
import { Icon } from '../ui/Icon';
import { FlagChip, JobStatusChip } from '../ui/StatusChip';
import { useToast } from '../ui/Toast';
import { Money } from '../ui/Money';
import { Status } from '../ui/StatusChip';
import { TicketCard } from '../ui/TicketCard';
import { CountdownRing } from '../ui/CountdownRing';

const CHECKLIST_DISMISSED_KEY = 'paidar.checklist.dismissed';

function lagosGreeting(): string {
  const hour = (new Date().getUTCHours() + 1) % 24;
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function TodayPage() {
  useDocumentTitle('Dashboard');
  const { provider } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [period, setPeriod] = useState<'week' | 'month' | '30d' | 'all'>('month');
  const [checklistHidden, setChecklistHidden] = useState(() => {
    try { return localStorage.getItem(CHECKLIST_DISMISSED_KEY) === '1'; } catch { return false; }
  });

  const { data: today, isLoading: todayLoading } = useQuery({
    queryKey: ['today'],
    queryFn: () => todayApi.get(),
  });

  const { data: queue } = useQuery({
    queryKey: ['queue'],
    queryFn: () => queueApi.get(),
  });

  const startMut = useMutation({
    mutationFn: (jobId: string) => queueApi.transition(jobId, 'start'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['queue'] });
      void qc.invalidateQueries({ queryKey: ['today'] });
      toast.success('Started. Good luck.');
    },
  });

  const checkMut = useMutation({
    mutationFn: async (_requestId: string) => {
      await qc.invalidateQueries({ queryKey: ['today'] });
    },
    onSuccess: () => {
      toast.info('Checked payment status.');
    },
  });

  const receivedTotal = useMemo(
    () => (today?.justPaid ?? []).reduce((s, x) => s + BigInt(x.payment.amountKobo), 0n),
    [today],
  );
  const awaitingTotal = useMemo(
    () => (today?.waiting ?? []).reduce((s, x) => s + BigInt(x.request.amountKobo), 0n),
    [today],
  );

  const nextUp = useMemo(() => {
    if (!queue) return [];
    return [...queue.inProgress, ...queue.ready].slice(0, 5);
  }, [queue]);

  const riskCounts = useMemo(() => {
    const all = queue ? [...queue.inProgress, ...queue.ready] : [];
    const overdue = all.filter((j) => j.isOverdue).length;
    const atRisk = all.filter((j) => j.isAtRisk && !j.isOverdue).length;
    return { overdue, atRisk, total: overdue + atRisk };
  }, [queue]);

  const awaitingOldest = useMemo(() => {
    return [...(today?.waiting ?? [])]
      .sort((a, b) => Date.parse(a.request.createdAt) - Date.parse(b.request.createdAt))
      .slice(0, 5);
  }, [today]);

  const recentPaid = useMemo(() => (today?.justPaid ?? []).slice(0, 5), [today]);

  // Priority Hero Waiting Ticket: customer-claimed first, then earliest expiry (§6.4)
  const heroWaiting = useMemo(() => {
    const list = today?.waiting ?? [];
    if (!list.length) return null;
    return [...list].sort((a, b) => {
      const ca = a.request.customerClaimedPaidAt ? 0 : 1;
      const cb = b.request.customerClaimedPaidAt ? 0 : 1;
      if (ca !== cb) return ca - cb;
      const ea = a.request.expiresAt ? Date.parse(a.request.expiresAt) : Number.MAX_SAFE_INTEGER;
      const eb = b.request.expiresAt ? Date.parse(b.request.expiresAt) : Number.MAX_SAFE_INTEGER;
      return ea - eb;
    })[0];
  }, [today]);

  const isBrandNew =
    !todayLoading &&
    (today?.justPaid.length ?? 0) === 0 &&
    (today?.waiting.length ?? 0) === 0 &&
    nextUp.length === 0;

  function dismissChecklist() {
    setChecklistHidden(true);
    try { localStorage.setItem(CHECKLIST_DISMISSED_KEY, '1'); } catch { /* ignore */ }
  }

  return (
    <div data-flow-id="DSH-00">
      {/* Header */}
      <div className="pf-page-head">
        <div>
          <h1 data-flow-id="DSH-01">{lagosGreeting()}, {provider?.businessName ?? 'Studio'}</h1>
          <p className="pf-page-head__sub">Here’s what needs your attention today.</p>
        </div>
        <div className="pf-page-head__actions">
          <select
            aria-label="Metrics period"
            value={period}
            onChange={(e) => setPeriod(e.target.value as typeof period)}
            data-flow-id="DSH-03"
            className="pd-input"
            style={{ width: 'auto', minHeight: 44, padding: '0 14px', fontSize: 13.5, fontWeight: 600 }}
          >
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="30d">Last 30 days</option>
            <option value="all">All time</option>
          </select>
          <Link to="/app/new" className="pf-btn pf-btn--primary" data-flow-id="DSH-02">
            <Icon name="plus" size={16} />
            <span>New request</span>
          </Link>
        </div>
      </div>

      {/* Money Line Flux Meter & Hero Waiting Ticket (§4.7 & §6.4) */}
      {!isBrandNew && (
        <div className="ob-flux-grid">
          <div className="pf-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="ob-overline">Money Line · Africa/Lagos</span>
              <Status tone={navigator.onLine ? 'mint' : 'solar'} icon={navigator.onLine ? 'shield' : 'clock'} label={navigator.onLine ? 'Live' : 'Offline'} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 20 }}>
              <div>
                <div className="ob-overline" style={{ marginBottom: 6 }}>Landing soon</div>
                <Money kobo={awaitingTotal.toString()} size="xl" tone="solar" animate />
                <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 6 }}>{today?.waiting.length ?? 0} active requests</div>
              </div>
              <div>
                <div className="ob-overline" style={{ marginBottom: 6 }}>Landed ({period})</div>
                <Money kobo={receivedTotal.toString()} size="xl" tone="mint" animate />
                <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 6 }}>{today?.justPaid.length ?? 0} bank-verified credits</div>
              </div>
            </div>
          </div>

          {heroWaiting ? (
            <TicketCard
              hero
              state={heroWaiting.request.customerClaimedPaidAt ? 'claims' : 'waiting'}
              title={<Link to={`/app/jobs/${heroWaiting.job.id}`} className="pd-plainlink">{heroWaiting.job.customer.name}</Link>}
              subtitle={heroWaiting.job.service}
              amountKobo={heroWaiting.request.amountKobo}
              aside={
                heroWaiting.request.sentAt && heroWaiting.request.expiresAt ? (
                  <CountdownRing sentAt={heroWaiting.request.sentAt} expiresAt={heroWaiting.request.expiresAt} size="sm" />
                ) : undefined
              }
              status={
                heroWaiting.request.customerClaimedPaidAt ? (
                  <Status tone="solar" icon="radar" label="Customer says paid" pulse />
                ) : (
                  <Status tone="solar" icon="clock" label="Awaiting payment" />
                )
              }
              footer={
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {heroWaiting.request.customerClaimedPaidAt && (
                    <button type="button" className="pf-btn pf-btn--sm pf-btn--primary" onClick={() => checkMut.mutate(heroWaiting.request.id)}>
                      Check now
                    </button>
                  )}
                  <button type="button" className="pf-btn pf-btn--sm pf-btn--secondary" onClick={() => void navigator.clipboard?.writeText(heroWaiting.request.payLink).then(() => toast.success('Payment link copied'))}>
                    Copy link
                  </button>
                </div>
              }
            />
          ) : (
            <div className="pf-card" style={{ display: 'grid', placeItems: 'center', textAlign: 'center' }}>
              <div>
                <div className="ob-overline" style={{ marginBottom: 6 }}>Active Watch</div>
                <p style={{ color: 'var(--ink-2)', fontSize: 14 }}>No live payment requests waiting right now.</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4 Metric Cards (Blueprint §2.5: Payments received · Outstanding · Active jobs · Overdue / Attention) */}
      <div className="pf-metrics">
        <Link to="/app/payments?tab=received" className="pf-metric ob-rise" data-flow-id="DSH-04">
          <div className="pf-metric__top">
            <span>Payments received</span>
            <Icon name="shield" size={16} />
          </div>
          <div className="pf-metric__val"><Money kobo={receivedTotal.toString()} size="md" /></div>
          <div className="pf-metric__sub">
            {receivedTotal === 0n ? 'Your first verified payment will show here.' : `${today?.justPaid.length ?? 0} verified`}
          </div>
        </Link>

        <Link to="/app/payments?tab=awaiting" className="pf-metric ob-rise" data-flow-id="DSH-05">
          <div className="pf-metric__top">
            <span>Outstanding payments</span>
            <Icon name="clock" size={16} />
          </div>
          <div className="pf-metric__val"><Money kobo={awaitingTotal.toString()} size="md" /></div>
          <div className="pf-metric__sub">
            {today?.waiting.length ?? 0} unpaid · {(today?.counts.needsReview ?? 0) > 0 ? `${today?.counts.needsReview} need review` : 'No exceptions'}
          </div>
        </Link>

        <Link to="/app/queue" className="pf-metric" data-flow-id="DSH-06">
          <div className="pf-metric__top">
            <span>Active jobs</span>
            <Icon name="queue" size={16} />
          </div>
          <div className="pf-metric__val">
            {(queue?.inProgress.length ?? 0) + (queue?.ready.length ?? 0)}
          </div>
          <div className="pf-metric__sub">
            {queue?.inProgress.length ?? 0} in progress · {queue?.ready.length ?? 0} ready
          </div>
        </Link>

        <Link to="/app/queue?filter=risk" className="pf-metric" data-flow-id="DSH-07">
          <div className="pf-metric__top">
            <span>Overdue &amp; at-risk</span>
            <Icon name="alert" size={16} />
          </div>
          <div className={`pf-metric__val ${riskCounts.overdue > 0 ? 'pf-metric__val--danger' : ''}`}>
            {riskCounts.overdue}
          </div>
          <div className="pf-metric__sub">
            {riskCounts.overdue} overdue · {riskCounts.atRisk} deadline at risk
          </div>
        </Link>
      </div>

      {/* Unmatched / flagged payment review alert (Blueprint §2.2 & §2.5) */}
      {(today?.counts.needsReview ?? 0) > 0 && (
        <div className="pf-card" style={{ marginBottom: 16, borderColor: 'var(--flare-bd)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="alert" size={18} />
            <div>
              <strong>{today!.counts.needsReview} payment{today!.counts.needsReview === 1 ? '' : 's'} need{today!.counts.needsReview === 1 ? 's' : ''} attention</strong>
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>Review mismatched amounts, late transfers, or unallocated references.</div>
            </div>
          </div>
          <Link to="/app/payments?tab=attention" className="pf-btn pf-btn--sm pf-btn--secondary">Resolve exceptions</Link>
        </div>
      )}

      {/* First-run checklist (DSH-08) */}
      {!checklistHidden && (
        <div className="pf-card" style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }} data-flow-id="DSH-08">
          <div>
            <strong style={{ fontSize: 14 }}>Getting started</strong>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
              <span>{(today?.waiting.length ?? 0) + (today?.justPaid.length ?? 0) > 0 ? '✓' : '☐'} Create first request</span>
              <span>{(today?.justPaid.length ?? 0) > 0 ? '✓' : '☐'} See first verified payment</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Link to="/app/new" className="pf-btn pf-btn--sm pf-btn--secondary">Create request</Link>
            <button type="button" onClick={dismissChecklist} aria-label="Dismiss checklist" style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)' }}>
              <Icon name="x" size={16} />
            </button>
          </div>
        </div>
      )}

      {isBrandNew ? (
        <div className="pf-card" style={{ textAlign: 'center', padding: 48 }}>
          <h2 style={{ marginBottom: 8 }}>Ready for your first payment request</h2>
          <p style={{ color: 'var(--text-secondary)', maxWidth: 420, margin: '0 auto 20px' }}>
            Create a request in four fields, share the link with your client, and let verified payments move work into your queue.
          </p>
          <Link to="/app/new" className="pf-btn pf-btn--primary">Create your first payment request</Link>
        </div>
      ) : (
        <>
          {/* 7/5 Main Content Split */}
          <div className="pf-dash-split">
            {/* Primary Column: Next up (DSH-09) */}
            <section className="pf-card" data-flow-id="DSH-09">
              <div className="pf-panel-head">
                <h2>Next up</h2>
                <Link to="/app/queue" className="pf-panel-link">Open full queue</Link>
              </div>
              {nextUp.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: 13.5 }}>Nothing ready. Paid jobs appear here.</p>
              ) : (
                <div className="pf-list-rows">
                  {nextUp.map((item) => (
                    <div key={item.id} className="pf-row">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span className="pd-mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>#{item.rank}</span>
                          <Link to={`/app/jobs/${item.id}`} style={{ fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>
                            {item.title}
                          </Link>
                          <JobStatusChip status={item.workStatus} />
                          {item.isOverdue && <FlagChip flag="overdue" />}
                          {item.isAtRisk && <FlagChip flag="at_risk" />}
                        </div>
                        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 3 }}>
                          {item.client.name} · {item.reasonLabel}
                        </div>
                      </div>
                      {item.workStatus === 'ready' && (
                        <button
                          type="button"
                          className="pf-btn pf-btn--sm pf-btn--primary"
                          disabled={startMut.isPending}
                          onClick={() => startMut.mutate(item.id)}
                        >
                          Start
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Secondary Column: Awaiting payment (DSH-10) */}
            <section className="pf-card ob-rise" data-flow-id="DSH-10">
              <div className="pf-panel-head">
                <h2>Awaiting payment</h2>
                <Link to="/app/payments?tab=awaiting" className="pf-panel-link">View all</Link>
              </div>
              {awaitingOldest.length === 0 ? (
                <p style={{ color: 'var(--ink-2)', fontSize: 13.5 }}>No unpaid requests.</p>
              ) : (
                <div className="pf-list-rows ob-wait-rail">
                  {awaitingOldest.map(({ request: r, job: j }) => (
                    <div key={r.id} className="pf-row" style={{ flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink-1)' }}>{j.customer.name}</div>
                        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Money kobo={r.amountKobo} size="sm" />
                          <span>· {j.service}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <a
                          href={`https://wa.me/${j.customer.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi ${j.customer.name.split(' ')[0]}, friendly reminder for ${j.service}: ${r.payLink}`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="pf-btn pf-btn--sm pf-btn--secondary"
                        >
                          Remind
                        </a>
                        <CopyChip value={r.payLink} label="Copy" copyLabel="Payment link" />
                        <button type="button" className="pf-btn pf-btn--sm pf-btn--secondary" onClick={() => checkMut.mutate(r.id)}>
                          Check
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Lower Content: Recent verified payments (DSH-11) */}
          <section className="pf-card" data-flow-id="DSH-11">
            <div className="pf-panel-head">
              <h2>Recent verified payments</h2>
              <Link to="/app/payments?tab=received" className="pf-panel-link">Open ledger</Link>
            </div>
            {recentPaid.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: 13.5 }}>No payments yet.</p>
            ) : (
              <div className="pf-list-rows">
                {recentPaid.map(({ payment: p, job: j }) => (
                  <Link
                    key={p.id}
                    to={`/app/payments?tab=received&payment=${p.id}`}
                    className="pf-row"
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{p.payerName ?? j.customer.name}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{j.customer.name} · {j.service}</div>
                    </div>
                      <div style={{ textAlign: 'right' }}>
                        <Money kobo={p.amountKobo} size="sm" tone="mint" />
                        <div className="pd-mono" style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{formatTime(p.receivedAt)}</div>
                      </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
