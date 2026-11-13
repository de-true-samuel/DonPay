import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { describeError } from '../api/errors';
import { RequestCard } from '../features/requests/RequestCard';
import { BalanceRow, ExpiredRow, PaidItem, ReminderRow, ReviewRow } from '../features/today/TodayRows';
import { useToday } from '../features/today/useToday';
import { useDocumentTitle, useNow } from '../lib/hooks';
import { timeAgo } from '../lib/time';
import { CountdownRing } from '../ui/CountdownRing';
import { Banner, Button, EmptyState, LinkButton, Skeleton } from '../ui/primitives';
import { StatusPill } from '../ui/Trust';
import { TicketCard } from '../ui/TicketCard';

function Section({ title, count, to, children }: { title: string; count: number; to?: string; children: ReactNode }) {
  if (!count) return null;
  return (
    <section className="pd-qsection">
      <h2 className="pd-qsection__h">{title}<span className="pd-count">{count}</span>{to && <Link to={to} className="pd-qsection__more">See all</Link>}</h2>
      <div className="pd-qsection__list">{children}</div>
    </section>
  );
}

function summaryLine(c: { justPaid: number; waiting: number; balancesDue: number; expired: number; needsReview: number; remindersDue?: number }): string {
  const parts = [
    c.needsReview && `${c.needsReview} to review`,
    c.remindersDue && `${c.remindersDue} ${c.remindersDue === 1 ? 'reminder' : 'reminders'} due`,
    c.justPaid && `${c.justPaid} paid today`,
    c.waiting && `${c.waiting} waiting`,
    c.balancesDue + c.expired && `${c.balancesDue + c.expired} to follow up`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Nothing needs you right now.';
}

export function TodayPage() {
  useDocumentTitle('Today');
  const { provider } = useAuth();
  const q = useToday();
  const now = useNow(5000);
  const sample = useMemo(() => {
    const t = Date.now();
    return { sentAt: new Date(t - 27 * 60_000).toISOString(), expiresAt: new Date(t + 33 * 60_000).toISOString() };
  }, []);

  const t = q.data;
  const empty = t && Object.values(t.counts).every((n) => n === 0);

  return (
    <>
      <header className="pd-pagehead">
        <h1>Today</h1>
        <p className="pd-sub">{t ? summaryLine(t.counts) : (q.isPending ? <Skeleton h={16} w={180} /> : ' ')}</p>
        {t && <p className="pd-live" aria-live="off">Live · updated {timeAgo(new Date(q.dataUpdatedAt).toISOString(), now)}</p>}
      </header>

      {provider && !provider.telegramLinked && (
        <Banner tone="warn" action={<LinkButton to="/settings" variant="line">Connect</LinkButton>}>
          Connect Telegram to get a ping the moment someone pays.
        </Banner>
      )}

      {q.isPending && (
        <div className="pd-qsection__list" aria-busy="true" aria-label="Loading Today">
          <Skeleton h={132} /><Skeleton h={132} /><Skeleton h={64} />
        </div>
      )}

      {q.isError && !t && (
        <Banner tone="bad" action={<Button variant="line" onClick={() => void q.refetch()}>Try again</Button>}>
          {describeError(q.error).message}
        </Banner>
      )}

      {t && !empty && (
        <>
          <Section title="Needs review" count={t.needsReview.length} to="/review">
            {t.needsReview.map((r) => <ReviewRow key={r.id} item={r} />)}
          </Section>
          {t.remindersDue && t.remindersDue.length > 0 && (
            <Section title="Reminders due" count={t.remindersDue.length}>
              {t.remindersDue.map((x) => <ReminderRow key={x.request.id} request={x.request} job={x.job} />)}
            </Section>
          )}
          <Section title="Just paid" count={t.justPaid.length}>
            {t.justPaid.map((x) => <PaidItem key={x.payment.id} payment={x.payment} job={x.job} />)}
          </Section>
          <Section title="Balances due" count={t.balancesDue.length}>
            {t.balancesDue.map((j) => <BalanceRow key={j.id} job={j} />)}
          </Section>
          <Section title="Expired, get new details" count={t.expired.length}>
            {t.expired.map((x) => <ExpiredRow key={x.request.id} request={x.request} job={x.job} />)}
          </Section>
          <Section title="Waiting for payment" count={t.waiting.length}>
            {t.waiting.map((x) => <RequestCard key={x.request.id} request={x.request} job={x.job} linkToJob />)}
          </Section>
        </>
      )}

      {empty && (
        <>
          <EmptyState title="Your day is clear" action={<LinkButton to="/new" icon="plus">Create payment details</LinkButton>}>
            Create payment details for a job and they wait here with a countdown. When the bank confirms the payment, it moves up as paid.
          </EmptyState>
          <section className="pd-example" aria-hidden="true">
            <p className="pd-eg-label">What a waiting request will look like</p>
            <TicketCard ghost title="Tolu · Bridal makeup" subtitle="Deposit · created 27 minutes ago · not copied yet" amountKobo="2500000"
              status={<StatusPill status="SENT" />} aside={<CountdownRing sentAt={sample.sentAt} expiresAt={sample.expiresAt} />} />
          </section>
        </>
      )}
    </>
  );
}
