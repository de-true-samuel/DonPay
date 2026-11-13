import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { describeError } from '../api/errors';
import { jobsApi } from '../api/endpoints';
import {
  ActivePaymentRow,
  BalanceRow,
  ExpiredRow,
  ReminderRow,
  ReviewRow,
  SettledPaymentRow,
} from '../features/today/TodayRows';
import { useToday } from '../features/today/useToday';
import { useDocumentTitle, useNow } from '../lib/hooks';
import { formatNaira } from '../lib/money';
import { timeAgo } from '../lib/time';
import { Icon } from '../ui/Icon';
import { Banner, Button, EmptyState, LinkButton, Skeleton } from '../ui/primitives';

function Section({ title, count, to, children }: { title: string; count: number; to?: string; children: ReactNode }) {
  if (!count) return null;
  return (
    <section className="pd-qsection" style={{ marginTop: 24 }}>
      <h2 className="pd-qsection__h">
        {title}
        <span className="pd-count">{count}</span>
        {to && <Link to={to} className="pd-qsection__more">See all</Link>}
      </h2>
      <div className="pd-qsection__list">{children}</div>
    </section>
  );
}

export function TodayPage() {
  useDocumentTitle('Today');
  const { provider } = useAuth();
  const q = useToday();
  const now = useNow(5000);

  // Fetch all jobs for dashboard-wide financial metrics
  const allJobs = useQuery({
    queryKey: ['jobs', 'dashboard-metrics'],
    queryFn: () => jobsApi.list({ limit: 100 }),
    staleTime: 10_000,
  });

  const t = q.data;

  // Total Verified Revenue: sum across jobs + today's justPaid
  const totalRevenueKobo = useMemo(() => {
    const fromJobs = allJobs.data?.items?.reduce((acc, j) => acc + BigInt(j.paidKobo), 0n) ?? 0n;
    const fromJustPaid = t?.justPaid?.reduce((acc, x) => acc + BigInt(x.payment.amountKobo), 0n) ?? 0n;
    return (fromJobs > fromJustPaid ? fromJobs : fromJustPaid).toString();
  }, [allJobs.data, t]);

  // Active in-flight funds on open 60-min virtual accounts
  const inFlightKobo = useMemo(() => {
    return (t?.waiting?.reduce((acc, x) => acc + BigInt(x.request.amountKobo), 0n) ?? 0n).toString();
  }, [t]);

  // Outstanding balances due on milestone jobs
  const balancesDueKobo = useMemo(() => {
    return (t?.balancesDue?.reduce((acc, j) => acc + BigInt(j.balanceKobo), 0n) ?? 0n).toString();
  }, [t]);

  const empty = t && Object.values(t.counts).every((n) => n === 0) && (!allJobs.data || allJobs.data.items.length === 0);

  return (
    <>
      <header className="pd-dash-header">
        <div>
          <h1 className="pd-dash-title">
            {provider?.businessName ? `Hello, ${provider.businessName}` : 'Dashboard'}
          </h1>
          <p className="pd-sub" style={{ margin: '4px 0 0' }}>
            Live payment verification and transfer monitoring.
          </p>
        </div>
        {t && (
          <div className="pd-dash-live" aria-live="off">
            <span className="pd-auth-pulse-dot" style={{ width: 6, height: 6 }} />
            <span>Live · updated {timeAgo(new Date(q.dataUpdatedAt).toISOString(), now)}</span>
          </div>
        )}
      </header>

      {q.isPending && (
        <div style={{ display: 'grid', gap: 16, marginBottom: 24 }}>
          <Skeleton h={100} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Skeleton h={220} />
            <Skeleton h={220} />
          </div>
        </div>
      )}

      {q.isError && !t && (
        <Banner tone="bad" action={<Button variant="line" onClick={() => void q.refetch()}>Try again</Button>}>
          {describeError(q.error).message}
        </Banner>
      )}

      {t && (
        <>
          {/* Balance Overview Divs */}
          <div className="pd-balance-grid">
            <div className="pd-balance-card pd-balance-card--emerald">
              <div className="pd-balance-card__top">
                <span className="pd-balance-card__label">Verified Revenue</span>
                <span className="pd-balance-card__badge pd-balance-card__badge--emerald">
                  ✓ Settled via Kora
                </span>
              </div>
              <div className="pd-balance-card__amount">
                {formatNaira(totalRevenueKobo, 'auto')}
              </div>
              <p className="pd-balance-card__sub">
                Bank-verified credits across all customer orders
              </p>
            </div>

            <div className="pd-balance-card pd-balance-card--amber">
              <div className="pd-balance-card__top">
                <span className="pd-balance-card__label">Active In-Flight</span>
                <span className="pd-balance-card__badge pd-balance-card__badge--amber">
                  {t.waiting.length} active {t.waiting.length === 1 ? 'account' : 'accounts'}
                </span>
              </div>
              <div className="pd-balance-card__amount">
                {formatNaira(inFlightKobo, 'auto')}
              </div>
              <p className="pd-balance-card__sub">
                Awaiting customer transfer in 60-min window
              </p>
            </div>

            <div className="pd-balance-card pd-balance-card--violet">
              <div className="pd-balance-card__top">
                <span className="pd-balance-card__label">Balances to Collect</span>
                <span className="pd-balance-card__badge pd-balance-card__badge--violet">
                  {t.balancesDue.length} milestone {t.balancesDue.length === 1 ? 'job' : 'jobs'}
                </span>
              </div>
              <div className="pd-balance-card__amount">
                {formatNaira(balancesDueKobo, 'auto')}
              </div>
              <p className="pd-balance-card__sub">
                Outstanding second payments due
              </p>
            </div>
          </div>

          {/* Quick Action Toolbar */}
          <div className="pd-quick-bar">
            <span>Quick Actions:</span>
            <LinkButton to="/new" icon="plus">Create Payment Details</LinkButton>
            <LinkButton to="/jobs" variant="line">All Jobs & Ledgers</LinkButton>
            <LinkButton to="/people" variant="line">Customer Directory</LinkButton>
          </div>

          {/* Critical Needs Review section if any anomaly exists */}
          {t.needsReview.length > 0 && (
            <Section title="Needs Review" count={t.needsReview.length} to="/review">
              {t.needsReview.map((r) => <ReviewRow key={r.id} item={r} />)}
            </Section>
          )}

          {/* Side-by-Side Panes for Settled Credits vs Registered Payments */}
          <div className="pd-dash-panes">
            {/* Pane 1: People Who Sent Money */}
            <div className="pd-pane">
              <div className="pd-pane__head">
                <div className="pd-pane__titlewrap">
                  <h3 className="pd-pane__title">People Who Sent Money</h3>
                  <span className="pd-pane__count">{t.justPaid.length}</span>
                </div>
                {t.justPaid.length > 0 && (
                  <span style={{ fontSize: 13, color: '#059669', fontWeight: 600 }}>
                    ● Real-time settled
                  </span>
                )}
              </div>

              <div className="pd-pane__list">
                {t.justPaid.length > 0 ? (
                  t.justPaid.map((x) => (
                    <SettledPaymentRow key={x.payment.id} payment={x.payment} job={x.job} />
                  ))
                ) : (
                  <div className="pd-pane-empty">
                    <Icon name="check" size={32} />
                    <p>No transfers recorded today yet. When customer bank payments land, they appear here instantly.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Pane 2: Registered Payments (Awaiting Transfer) */}
            <div className="pd-pane">
              <div className="pd-pane__head">
                <div className="pd-pane__titlewrap">
                  <h3 className="pd-pane__title">Registered Payments</h3>
                  <span className="pd-pane__count">{t.waiting.length}</span>
                </div>
                {t.waiting.length > 0 && (
                  <span style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 600 }}>
                    Active 60m pipeline
                  </span>
                )}
              </div>

              <div className="pd-pane__list">
                {t.waiting.length > 0 ? (
                  t.waiting.map((x) => (
                    <ActivePaymentRow key={x.request.id} request={x.request} job={x.job} />
                  ))
                ) : (
                  <div className="pd-pane-empty">
                    <Icon name="today" size={32} />
                    <p>No open payment requests. Tap “Create Payment Details” to allocate a 60-minute virtual account.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Secondary Queues */}
          {t.remindersDue && t.remindersDue.length > 0 && (
            <Section title="Reminders due" count={t.remindersDue.length}>
              {t.remindersDue.map((x) => <ReminderRow key={x.request.id} request={x.request} job={x.job} />)}
            </Section>
          )}

          {t.balancesDue.length > 0 && (
            <Section title="Balances due" count={t.balancesDue.length}>
              {t.balancesDue.map((j) => <BalanceRow key={j.id} job={j} />)}
            </Section>
          )}

          {t.expired.length > 0 && (
            <Section title="Expired, get new details" count={t.expired.length}>
              {t.expired.map((x) => <ExpiredRow key={x.request.id} request={x.request} job={x.job} />)}
            </Section>
          )}
        </>
      )}

      {empty && (
        <EmptyState title="Your dashboard is ready" action={<LinkButton to="/new" icon="plus">Create payment details</LinkButton>}>
          Create payment details for a customer and they appear in your Registered Payments pane with an active 60-minute countdown.
        </EmptyState>
      )}
    </>
  );
}
