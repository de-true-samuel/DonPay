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

  if (q.isPending)
    return (
      <div className="pd-stack" aria-busy="true">
        <Skeleton h={34} w="55%" />
        <Skeleton h={60} />
        <Skeleton h={140} />
      </div>
    );

  if (q.isError || !q.data) {
    const missing = q.error instanceof ApiRequestError && q.error.status === 404;
    return missing ? (
      <EmptyState
        title="That ticket doesn’t exist."
        action={
          <LinkButton to="/today" variant="line">
            Back to Today
          </LinkButton>
        }
      >
        It may have been removed.
      </EmptyState>
    ) : (
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
    );
  }

  const j = q.data;
  const open = j.openRequest;
  const cancelled = j.status === 'CANCELLED';
  const total = BigInt(j.totalKobo);
  const pct =
    total > 0n
      ? Math.min(100, Math.max(0, Number((BigInt(j.paidKobo) * 10000n) / total) / 100))
      : 0;
  const owed = BigInt(j.balanceKobo) > 0n;
  const over = BigInt(j.balanceKobo) < 0n;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', display: 'grid', gap: 24 }}>
      {/* Header (Spec Section 5.8) */}
      <div>
        <Link to="/jobs" className="pd-back" style={{ color: 'var(--muted-on-ground)' }}>
          <Icon name="chevron" size={16} />
          <span>Jobs</span>
        </Link>
        <header style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <h1
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 800,
                fontSize: 'clamp(28px, 7vw, 36px)',
                letterSpacing: '-0.02em',
                color: 'var(--ink-on-ground)',
                margin: 0,
              }}
            >
              <Link to={`/people/${j.customer.id}`} className="pd-plainlink" style={{ color: 'inherit' }}>
                {j.customer.name}
              </Link>
            </h1>
            {!cancelled && (
              <Button variant="line" icon="pencil" onClick={() => setDlg('edit')}>
                Edit
              </Button>
            )}
          </div>
          <p style={{ color: 'var(--muted-on-ground)', fontSize: 16, margin: '4px 0 10px' }}>
            {j.service}
          </p>
          {j.notes && (
            <p style={{ color: 'var(--muted-on-ground)', fontSize: 14, fontStyle: 'italic', margin: '0 0 10px' }}>
              {j.notes}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <JobStatusPill status={j.status} />
            {j.readyToStart && <ReadyBadge />}
          </div>
        </header>
      </div>

      {/* Payment Progress Bar & Summary (Spec Section 5.8) */}
      <section
        style={{
          background: 'var(--paper)',
          borderRadius: 'var(--r-ticket)',
          padding: '24px 22px',
          color: 'var(--paper-ink)',
          boxShadow: '0 12px 28px rgba(16, 21, 77, 0.3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24 }}>
            {formatNaira(j.paidKobo)}
            <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--paper-muted)', marginLeft: 6 }}>
              paid of {formatNaira(j.totalKobo)}
            </span>
          </div>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--ok)' }}>
            {Math.round(pct)}%
          </span>
        </div>

        {/* Progress bar with ticks */}
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          style={{
            height: 10,
            borderRadius: 999,
            background: 'rgba(20, 24, 63, 0.1)',
            overflow: 'hidden',
            marginBottom: 12,
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              background: 'var(--ok)',
              borderRadius: 999,
              transition: 'width 0.4s ease',
            }}
          />
        </div>

        <p style={{ margin: 0, fontSize: 14, color: 'var(--paper-muted)' }}>
          {over
            ? `Overpaid by ${formatNaira((-BigInt(j.balanceKobo)).toString())}`
            : owed
              ? `${formatNaira(j.balanceKobo)} still to pay${j.balanceDueAt ? ` · due ${formatDate(j.balanceDueAt)}` : ''}`
              : 'Nothing left to pay.'}
        </p>

        {/* Two-stub ledger (Spec Section 5.8) */}
        {j.plan === 'DEPOSIT_BALANCE' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
              marginTop: 18,
              paddingTop: 16,
              borderTop: '1px dashed var(--line)',
            }}
          >
            {/* Stub 1: Deposit */}
            <div
              style={{
                background: j.depositKobo && BigInt(j.paidKobo) >= BigInt(j.depositKobo) ? 'var(--tag-paid-bg)' : 'rgba(20, 24, 63, 0.05)',
                border: `1.5px solid ${j.depositKobo && BigInt(j.paidKobo) >= BigInt(j.depositKobo) ? 'var(--ok)' : 'var(--line-strong)'}`,
                borderRadius: 14,
                padding: '12px 14px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--paper-ink)' }}>
                  Deposit
                </span>
                {j.depositKobo && BigInt(j.paidKobo) >= BigInt(j.depositKobo) && (
                  <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--ok)' }}>PAID ✓</span>
                )}
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, marginTop: 4 }}>
                {j.depositKobo ? formatNaira(j.depositKobo) : '—'}
              </div>
            </div>

            {/* Stub 2: Balance */}
            <div
              style={{
                background: BigInt(j.balanceKobo) <= 0n ? 'var(--tag-paid-bg)' : 'rgba(20, 24, 63, 0.05)',
                border: `1.5px dashed ${BigInt(j.balanceKobo) <= 0n ? 'var(--ok)' : 'var(--line-strong)'}`,
                borderRadius: 14,
                padding: '12px 14px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--paper-muted)' }}>
                  Balance
                </span>
                {BigInt(j.balanceKobo) <= 0n ? (
                  <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--ok)' }}>PAID ✓</span>
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--paper-muted)' }}>
                    {j.balanceDueAt ? `Due ${formatDate(j.balanceDueAt)}` : 'Pending'}
                  </span>
                )}
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, marginTop: 4 }}>
                {formatNaira(j.balanceKobo)}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Active Request Ticket / Next Payment (Spec Section 5.8) */}
      <section>
        <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: 'var(--ink-on-ground)', marginBottom: 12 }}>
          {open ? 'Active payment ticket' : 'Next payment'}
        </h2>
        {open && <RequestCard request={open} job={j} />}
        {!open && cancelled && <Banner tone="bad">This job is cancelled.</Banner>}
        {!open && !cancelled && owed && (
          <div
            style={{
              background: 'var(--paper)',
              borderRadius: 'var(--r-ticket)',
              padding: '20px 22px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>No account active right now</p>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--paper-muted)' }}>
                {formatNaira(j.balanceKobo)} is still owed.
              </p>
            </div>
            <Button busy={a.balance.isPending} onClick={() => a.balance.mutate(j.id)}>
              Get balance details
            </Button>
          </div>
        )}
      </section>

      {/* Timeline (Receipt tape, Spec Section 5.8) */}
      <section
        style={{
          background: 'var(--paper)',
          borderRadius: 'var(--r-ticket)',
          padding: '24px 22px',
          color: 'var(--paper-ink)',
          boxShadow: '0 8px 24px rgba(16, 21, 77, 0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, margin: 0 }}>
            Timeline
          </h2>
          {!cancelled && (
            <Button variant="line" onClick={() => setDlg('manual')}>
              Record a payment
            </Button>
          )}
        </div>
        <JobTimeline
          items={items}
          receiptBusy={a.receipt.isPending ? a.receipt.variables?.paymentId : undefined}
          onReceipt={(paymentId) =>
            a.receipt.mutate({ paymentId, customerName: j.customer.name })
          }
        />
      </section>

      {/* Cancel Job (quiet link at the bottom, Spec Section 5.8) */}
      {!cancelled && (
        <div style={{ textAlign: 'center', padding: '12px 0 32px' }}>
          <button
            type="button"
            onClick={() => setDlg('cancel')}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--urgent)',
              fontSize: 14,
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >
            Cancel job
          </button>
        </div>
      )}

      <EditJobDialog job={j} open={dlg === 'edit'} onClose={() => setDlg(null)} />
      <ManualPaymentDialog job={j} open={dlg === 'manual'} onClose={() => setDlg(null)} />
      <CancelJobDialog job={j} open={dlg === 'cancel'} onClose={() => setDlg(null)} />
    </div>
  );
}
