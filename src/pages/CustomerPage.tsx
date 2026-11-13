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

  if (q.isPending) return <div className="pd-stack" aria-busy="true"><Skeleton h={34} w="50%" /><Skeleton h={56} /><Skeleton h={120} /></div>;
  if (q.isError || !q.data) {
    const missing = q.error instanceof ApiRequestError && q.error.status === 404;
    return missing
      ? <EmptyState title="That customer isn’t here" action={<LinkButton to="/people" variant="line">Back to People</LinkButton>}>They may have been removed.</EmptyState>
      : <Banner tone="bad" action={<Button variant="line" onClick={() => void q.refetch()}>Try again</Button>}>{describeError(q.error).message}</Banner>;
  }

  const { customer: c, jobs, timeline } = q.data;
  const owes = BigInt(c.outstandingKobo) > 0n;
  const owing = jobs.filter((j) => j.status !== 'CANCELLED' && BigInt(j.balanceKobo) > 0n).length;
  const lastJob = jobs.find((j) => j.status !== 'CANCELLED') ?? jobs[0];
  const repeatUrl = lastJob
    ? `/new?customerId=${c.id}&service=${encodeURIComponent(lastJob.service)}&plan=${lastJob.plan}&total=${lastJob.totalKobo}${lastJob.depositKobo ? `&deposit=${lastJob.depositKobo}` : ''}`
    : null;

  return (
    <div className="pd-stack">
      <div>
        <Link to="/people" className="pd-back"><Icon name="chevron" size={16} />People</Link>
        <header className="pd-jobhead">
          <h1>{c.name}</h1>
          <p className="pd-sub">{formatPhone(c.phone)}</p>
          <div className="pd-actions">
            <LinkButton to={`/new?customerId=${c.id}`} icon="plus">New request</LinkButton>
            {repeatUrl && <LinkButton to={repeatUrl} variant="line">Repeat last job</LinkButton>}
            <Button variant="line" icon="pencil" onClick={() => setEditing(true)}>Edit</Button>
          </div>
        </header>
      </div>

      <section className="pd-section" aria-label="What they owe">
        {owes
          ? <p className="pd-sumline"><Money kobo={c.outstandingKobo} size="xl" /> <span>owed across {owing} {owing === 1 ? 'job' : 'jobs'}</span></p>
          : <p className="pd-lede">Nothing owed right now.</p>}
      </section>

      <section className="pd-section" aria-labelledby="c-jobs">
        <h2 id="c-jobs">Jobs</h2>
        {jobs.length ? <ul className="pd-list">{jobs.map((j) => <li key={j.id}><JobRow job={j} /></li>)}</ul>
          : <p className="pd-lede">No jobs yet. Create payment details to start one.</p>}
      </section>

      {timeline.length > 0 && (
        <section className="pd-section" aria-labelledby="c-tl">
          <h2 id="c-tl">History</h2>
          <ol className="pd-tl">
            {timeline.map((e, i) => {
              const trust = e.type === 'PAYMENT_RECEIVED' ? 'verified' : e.type === 'MANUAL_PAYMENT' ? 'manual' : undefined;
              return (
                <li key={`${e.at}-${i}`} className={cls('pd-tl__item', trust && `pd-tl__item--${trust}`)}>
                  <span className="pd-tl__dot" aria-hidden="true" />
                  <div className="pd-tl__body">
                    <p className="pd-tl__label"><Link to={`/jobs/${e.jobId}`} className="pd-plainlink">{e.label}</Link></p>
                    <p className="pd-hint">{e.service} · {formatDateTime(e.at)}</p>
                  </div>
                  {e.amountKobo && (e.type === 'PAYMENT_RECEIVED' || e.type === 'MANUAL_PAYMENT') && <Money kobo={e.amountKobo} size="sm" />}
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
