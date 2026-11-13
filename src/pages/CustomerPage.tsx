import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ApiRequestError } from '../api/client';
import { describeError } from '../api/errors';
import { customersApi } from '../api/endpoints';
import { EditCustomerDialog } from '../features/customers/CustomerDialogs';
import { JobRow } from '../features/jobs/JobRow';
import { cls } from '../lib/cls';
import { useDocumentTitle } from '../lib/hooks';
import { formatNaira } from '../lib/money';
import { formatPhone } from '../lib/phone';
import { formatDateTime } from '../lib/time';
import { Icon } from '../ui/Icon';
import { Money } from '../ui/Money';
import { Banner, Button, EmptyState, LinkButton, Skeleton } from '../ui/primitives';

export function CustomerPage() {
  const { id = '' } = useParams();
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ['customer', id], queryFn: () => customersApi.get(id) });
  useDocumentTitle(q.data ? q.data.customer.name : 'Customer');

  if (q.isPending)
    return (
      <div className="pd-stack" aria-busy="true">
        <Skeleton h={34} w="50%" />
        <Skeleton h={56} />
        <Skeleton h={120} />
      </div>
    );

  if (q.isError || !q.data) {
    const missing = q.error instanceof ApiRequestError && q.error.status === 404;
    return missing ? (
      <EmptyState
        title="That customer isn’t here"
        action={
          <LinkButton to="/people" variant="line">
            Back to People
          </LinkButton>
        }
      >
        They may have been removed.
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

  const { customer: c, jobs, timeline } = q.data;
  const owes = BigInt(c.outstandingKobo) > 0n;
  const owing = jobs.filter((j) => j.status !== 'CANCELLED' && BigInt(j.balanceKobo) > 0n).length;
  const lastJob = jobs.find((j) => j.status !== 'CANCELLED') ?? jobs[0];
  const repeatUrl = lastJob
    ? `/new?customerId=${c.id}&service=${encodeURIComponent(lastJob.service)}&plan=${lastJob.plan}&total=${lastJob.totalKobo}${lastJob.depositKobo ? `&deposit=${lastJob.depositKobo}` : ''}`
    : null;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', display: 'grid', gap: 24 }}>
      <div>
        <Link to="/people" className="pd-back" style={{ color: 'var(--muted-on-ground)' }}>
          <Icon name="chevron" size={16} />
          <span>People</span>
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
              {c.name}
            </h1>
            <Button variant="line" icon="pencil" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </div>
          <p style={{ color: 'var(--muted-on-ground)', fontSize: 16, margin: '4px 0 16px' }}>
            {formatPhone(c.phone)}
          </p>

          {/* Outstanding Balance Hero if money is owed (Spec Section 5.9) */}
          {owes && (
            <div
              style={{
                background: 'var(--tag-urgent-bg)',
                border: '1.5px solid var(--urgent)',
                borderRadius: 'var(--r-slip)',
                padding: '16px 20px',
                color: 'var(--tag-urgent-ink)',
                marginBottom: 16,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>
                Total outstanding owed
              </span>
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 800,
                  fontSize: 32,
                  marginTop: 2,
                }}
              >
                {formatNaira(c.outstandingKobo)}
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 13 }}>
                Across {owing} {owing === 1 ? 'job' : 'jobs'}
              </p>
            </div>
          )}

          {/* Action Row */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            {repeatUrl && lastJob ? (
              <Link
                to={repeatUrl}
                className="pd-btn-primary"
                style={{
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span>Repeat last job</span>
                <span style={{ fontSize: 13, opacity: 0.85, fontWeight: 500 }}>
                  ({lastJob.service} · {formatNaira(lastJob.totalKobo)})
                </span>
              </Link>
            ) : null}
            <LinkButton to={`/new?customerId=${c.id}`} variant="line" icon="plus">
              New request
            </LinkButton>
          </div>
        </header>
      </div>

      {/* Jobs List (Spec Section 5.9) */}
      <section
        style={{
          background: 'var(--paper)',
          borderRadius: 'var(--r-ticket)',
          padding: '24px 22px',
          color: 'var(--paper-ink)',
          boxShadow: '0 8px 24px rgba(16, 21, 77, 0.25)',
        }}
      >
        <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, margin: '0 0 14px' }}>
          Jobs ({jobs.length})
        </h2>
        {jobs.length ? (
          <ul className="pd-list" style={{ display: 'grid', gap: 10, margin: 0, padding: 0, listStyle: 'none' }}>
            {jobs.map((j) => (
              <li key={j.id}>
                <JobRow job={j} />
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ color: 'var(--paper-muted)', margin: 0, fontSize: 14 }}>
            No jobs yet. Create payment details to start one.
          </p>
        )}
      </section>

      {/* Timeline (Receipt tape, Spec Section 5.9) */}
      {timeline.length > 0 && (
        <section
          style={{
            background: 'var(--paper)',
            borderRadius: 'var(--r-ticket)',
            padding: '24px 22px',
            color: 'var(--paper-ink)',
            boxShadow: '0 8px 24px rgba(16, 21, 77, 0.25)',
            marginBottom: 40,
          }}
        >
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, margin: '0 0 14px' }}>
            Payment History
          </h2>
          <ol className="pd-tl">
            {timeline.map((e, i) => {
              const trust =
                e.type === 'PAYMENT_RECEIVED'
                  ? 'verified'
                  : e.type === 'MANUAL_PAYMENT'
                    ? 'manual'
                    : undefined;
              return (
                <li
                  key={`${e.at}-${i}`}
                  className={cls('pd-tl__item', trust && `pd-tl__item--${trust}`)}
                >
                  <span className="pd-tl__dot" aria-hidden="true" />
                  <div className="pd-tl__body">
                    <p className="pd-tl__label">
                      <Link to={`/jobs/${e.jobId}`} className="pd-plainlink">
                        {e.label}
                      </Link>
                    </p>
                    <p className="pd-hint">
                      {e.service} · {formatDateTime(e.at)}
                    </p>
                  </div>
                  {e.amountKobo &&
                    (e.type === 'PAYMENT_RECEIVED' || e.type === 'MANUAL_PAYMENT') && (
                      <Money kobo={e.amountKobo} size="sm" />
                    )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <EditCustomerDialog customer={c} open={editing} onClose={() => setEditing(false)} />
    </div>
  );
}
