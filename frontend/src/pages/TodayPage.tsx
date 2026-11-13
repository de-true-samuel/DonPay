import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { describeError } from '../api/errors';
import {
  ActivePaymentRow,
  BalanceRow,
  ExpiredRow,
  ReminderRow,
  ReviewRow,
  SettledPaymentRow,
} from '../features/today/TodayRows';
import { useToday } from '../features/today/useToday';
import { useCopiedAt } from '../features/requests/copyTracker';
import { useRequestActions } from '../features/requests/useRequestActions';
import { useDocumentTitle, useNow } from '../lib/hooks';
import { formatNaira } from '../lib/money';
import { timeAgo } from '../lib/time';
import { CountdownRing } from '../ui/CountdownRing';
import { Banner, Button, LinkButton, Skeleton } from '../ui/primitives';
import { useToast } from '../ui/Toast';

function Section({
  title,
  count,
  to,
  children,
}: {
  title: string;
  count: number;
  to?: string;
  children: ReactNode;
}) {
  if (!count) return null;
  return (
    <section className="pd-qsection">
      <h2 className="pd-qsection__h">
        <span>
          {title}
          <span className="pd-count">{count}</span>
        </span>
        {to && (
          <Link to={to} className="pd-qsection__more">
            See all
          </Link>
        )}
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
  const actions = useRequestActions();
  const qc = useQueryClient();
  const toast = useToast();

  const t = q.data;

  // Formatted Lagos date
  const todayDateString = useMemo(() => {
    return new Intl.DateTimeFormat('en-NG', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'Africa/Lagos',
    }).format(now);
  }, [now]);

  // Landing soon: sum of waiting tickets
  const landingSoonKobo = useMemo(() => {
    return (
      t?.waiting?.reduce((acc, x) => acc + BigInt(x.request.amountKobo), 0n) ?? 0n
    ).toString();
  }, [t]);

  // Landed today: sum of verified payments today
  const landedTodayKobo = useMemo(() => {
    return (
      t?.justPaid?.reduce((acc, x) => acc + BigInt(x.payment.amountKobo), 0n) ?? 0n
    ).toString();
  }, [t]);

  // Sort waiting requests by urgency: customer-claimed-paid first, then least time remaining
  const sortedWaiting = useMemo(() => {
    if (!t?.waiting) return [];
    return [...t.waiting].sort((a, b) => {
      if (a.request.customerClaimedPaidAt && !b.request.customerClaimedPaidAt) return -1;
      if (!a.request.customerClaimedPaidAt && b.request.customerClaimedPaidAt) return 1;
      const expA = a.request.expiresAt ? Date.parse(a.request.expiresAt) : Infinity;
      const expB = b.request.expiresAt ? Date.parse(b.request.expiresAt) : Infinity;
      return expA - expB;
    });
  }, [t?.waiting]);

  const heroItem = sortedWaiting[0] ?? null;
  const otherWaiting = sortedWaiting.slice(1);

  // Copied state of hero item
  const heroCopiedAt = useCopiedAt(heroItem?.request.id ?? '');

  // Attention rail items count
  const claimsCount = useMemo(() => {
    return t?.waiting.filter((x) => !!x.request.customerClaimedPaidAt).length ?? 0;
  }, [t?.waiting]);

  const isEmpty =
    t &&
    Object.values(t.counts).every((n) => n === 0) &&
    t.waiting.length === 0 &&
    t.justPaid.length === 0;

  return (
    <>
      {/* 1. Header on the ground (Spec Section 5.6) */}
      <header className="pd-today-head">
        <p className="pd-today-date">{todayDateString}</p>
        <h1 className="pd-today-greeting">
          Good afternoon, {provider?.businessName || 'Provider'}
        </h1>
        {t && (
          <div className="pd-today-live" aria-live="off">
            <span className="pd-today-live-dot" />
            <span>Live · updated {timeAgo(new Date(q.dataUpdatedAt).toISOString(), now)}</span>
          </div>
        )}
      </header>

      {/* 2. The Money Line (Spec Section 5.6 & Proposed P4) */}
      <div className="pd-money-line">
        <div className="pd-money-cell">
          <p className="pd-money-label">Landing soon</p>
          <div className="pd-money-val">{formatNaira(landingSoonKobo, 'auto')}</div>
        </div>
        <div className="pd-money-divider" />
        <div className="pd-money-cell">
          <p className="pd-money-label">Landed today</p>
          <div className="pd-money-val">{formatNaira(landedTodayKobo, 'auto')}</div>
        </div>
      </div>

      {q.isPending && (
        <div style={{ display: 'grid', gap: 16, marginBottom: 24 }}>
          <Skeleton h={220} />
          <Skeleton h={80} />
          <Skeleton h={80} />
        </div>
      )}

      {q.isError && !t && (
        <Banner
          tone="bad"
          action={
            <Button variant="line" onClick={() => void q.refetch()}>
              Try again
            </Button>
          }
        >
          {describeError(q.error).message}
        </Banner>
      )}

      {t && (
        <>
          {/* 3. Attention Rail (Spec Section 5.6) */}
          {(t.needsReview.length > 0 || claimsCount > 0) && (
            <div className="pd-rail-chips">
              {t.needsReview.length > 0 && (
                <Link to="/review" className="pd-rail-chip pd-rail-chip--urgent">
                  <span>⚠ {t.needsReview.length} needs review</span>
                </Link>
              )}
              {claimsCount > 0 && (
                <a href="#hero-stage" className="pd-rail-chip pd-rail-chip--claims">
                  <span className="pd-tag-pulse-dot" />
                  <span>
                    {claimsCount} {claimsCount === 1 ? 'customer says' : 'customers say'} paid
                  </span>
                </a>
              )}
            </div>
          )}

          {/* 4. Hero Ticket: The most urgent waiting ticket (Spec Section 5.6) */}
          {heroItem && (
            <div className="pd-hero-stage" id="hero-stage">
              <article className="pd-hero-ticket">
                <div className="pd-ticket__top">
                  <div className="pd-ticket__who">
                    <h3>
                      <Link to={`/jobs/${heroItem.job.id}`} className="pd-plainlink">
                        {heroItem.job.customer.name}
                      </Link>
                    </h3>
                    <p>{heroItem.job.service}</p>
                  </div>
                  <div>
                    {heroItem.request.customerClaimedPaidAt ? (
                      <span className="pd-tag pd-tag--claims">
                        <span className="pd-tag-pulse-dot" />
                        <span>Customer says paid</span>
                      </span>
                    ) : heroCopiedAt ? (
                      <span className="pd-tag pd-tag--copied">
                        Copied {timeAgo(heroCopiedAt)}
                      </span>
                    ) : (
                      <span className="pd-tag pd-tag--waiting">Not copied yet</span>
                    )}
                  </div>
                </div>

                {/* Big Countdown Dial */}
                <div className="pd-hero-dial-wrap">
                  {heroItem.request.sentAt && heroItem.request.expiresAt && (
                    <CountdownRing
                      sentAt={heroItem.request.sentAt}
                      expiresAt={heroItem.request.expiresAt}
                      size="hero"
                    />
                  )}
                  <p className="pd-hero-dial-sub">left on this dynamic account</p>
                </div>

                {/* Notches + Tear line */}
                <div className="pd-ticket__cut" aria-hidden="true">
                  <i />
                  <i />
                </div>

                {/* Stub: Amount + Bank + CTA */}
                <div className="pd-ticket__bottom">
                  <div>
                    <div
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontWeight: 800,
                        fontSize: 32,
                        color: 'var(--paper-ink)',
                        letterSpacing: '-0.02em',
                      }}
                    >
                      {formatNaira(heroItem.request.amountKobo)}
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--paper-muted)', fontWeight: 500 }}>
                      {heroItem.request.bankName ?? 'Wema Bank'} ·{' '}
                      {heroItem.request.accountNumber ?? 'Account allocated'}
                    </p>
                  </div>
                </div>

                <div className="pd-hero-cta">
                  {heroItem.request.customerClaimedPaidAt ? (
                    <button
                      type="button"
                      className="pd-btn-primary pd-btn--block"
                      onClick={() => {
                        void qc.invalidateQueries({ queryKey: ['today'] });
                        void qc.invalidateQueries({ queryKey: ['jobs'] });
                        toast.info('Checking with bank for payments…');
                      }}
                    >
                      Check now
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="pd-btn-primary pd-btn--block"
                      disabled={actions.shareAgain.isPending}
                      onClick={() =>
                        actions.shareAgain.mutate({
                          request: heroItem.request,
                          job: heroItem.job,
                        })
                      }
                    >
                      {heroCopiedAt ? 'Copy details again' : 'Copy message'}
                    </button>
                  )}
                </div>
              </article>
            </div>
          )}

          {/* 5. Other Waiting Tickets (Horizontal Carousel, Spec Section 5.6) */}
          {otherWaiting.length > 0 && (
            <div className="pd-carousel-wrap">
              <h3 className="pd-carousel-title">
                Other waiting tickets ({otherWaiting.length})
              </h3>
              <div className="pd-carousel">
                {otherWaiting.map((item) => (
                  <div key={item.request.id} className="pd-carousel__item">
                    <ActivePaymentRow request={item.request} job={item.job} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 6. Queues (Spec Section 5.6) */}
          {/* Just Paid (Mini Receipts Strip) */}
          {t.justPaid.length > 0 && (
            <section className="pd-qsection">
              <h2 className="pd-qsection__h">
                <span>
                  Just paid <span className="pd-count">{t.justPaid.length}</span>
                </span>
              </h2>
              <div className="pd-receipt-strip">
                {t.justPaid.map((x) => (
                  <SettledPaymentRow key={x.payment.id} payment={x.payment} job={x.job} />
                ))}
              </div>
            </section>
          )}

          {/* Reminders due */}
          {t.remindersDue && t.remindersDue.length > 0 && (
            <Section title="Reminders due" count={t.remindersDue.length}>
              {t.remindersDue.map((x) => (
                <ReminderRow key={x.request.id} request={x.request} job={x.job} />
              ))}
            </Section>
          )}

          {/* Balances due */}
          {t.balancesDue.length > 0 && (
            <Section title="Balances due" count={t.balancesDue.length}>
              {t.balancesDue.map((j) => (
                <BalanceRow key={j.id} job={j} />
              ))}
            </Section>
          )}

          {/* Expired */}
          {t.expired.length > 0 && (
            <Section title="Expired" count={t.expired.length}>
              {t.expired.map((x) => (
                <ExpiredRow key={x.request.id} request={x.request} job={x.job} />
              ))}
            </Section>
          )}

          {/* Needs Review */}
          {t.needsReview.length > 0 && (
            <Section title="Needs review" count={t.needsReview.length} to="/review">
              {t.needsReview.map((r) => (
                <ReviewRow key={r.id} item={r} />
              ))}
            </Section>
          )}
        </>
      )}

      {/* 7. Empty State: Your day is clear (Spec Section 5.6) */}
      {isEmpty && (
        <div className="pd-today-empty">
          <h2>Your day is clear</h2>
          <p>
            Get payment details for a job. It waits here with a clock. When the bank confirms, it
            moves to Just paid.
          </p>
          <LinkButton to="/new" icon="plus">
            Create payment details
          </LinkButton>
        </div>
      )}
    </>
  );
}
