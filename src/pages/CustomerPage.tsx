import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ApiRequestError } from '../api/client';
import { describeError } from '../api/errors';
import { customersApi } from '../api/endpoints';
import { EditCustomerDialog } from '../features/customers/CustomerDialogs';
import { useDocumentTitle } from '../lib/hooks';
import { formatNaira } from '../lib/money';
import { formatPhone } from '../lib/phone';
import { formatTime } from '../lib/time';
import { Icon } from '../ui/Icon';
import { Banner, Button, EmptyState, Skeleton } from '../ui/primitives';
import { useToast } from '../ui/Toast';

export function CustomerPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<'jobs' | 'activity'>('jobs');
  const q = useQuery({ queryKey: ['customer', id], queryFn: () => customersApi.get(id) });
  useDocumentTitle(q.data ? q.data.customer.name : 'Client');

  if (q.isPending) {
    return (
      <div className="pd-stack" aria-busy="true">
        <Skeleton h={34} w="50%" />
        <Skeleton h={56} />
        <Skeleton h={120} />
      </div>
    );
  }

  if (q.isError || !q.data) {
    const missing = q.error instanceof ApiRequestError && q.error.status === 404;
    return missing ? (
      <EmptyState
        title="That client isn’t here"
        action={<Link to="/app/clients" className="pf-btn pf-btn--secondary">Back to Clients</Link>}
      >
        They may have been archived or removed.
      </EmptyState>
    ) : (
      <Banner tone="bad" action={<Button variant="line" onClick={() => void q.refetch()}>Try again</Button>}>
        {describeError(q.error).message}
      </Banner>
    );
  }

  const { customer: c, jobs, timeline } = q.data;
  const lifetimePaid = jobs.reduce((s, j) => s + BigInt(j.verifiedPaidKobo), 0n);

  function archiveClient() {
    try {
      const raw = localStorage.getItem('paidar.clients.archived');
      const list: string[] = raw ? JSON.parse(raw) : [];
      if (!list.includes(c.id)) list.push(c.id);
      localStorage.setItem('paidar.clients.archived', JSON.stringify(list));
    } catch { /* ignore */ }
    toast.info(`${c.name} archived. History is kept.`);
    nav('/app/clients');
  }

  return (
    <div style={{ maxWidth: 700, display: 'grid', gap: 18 }} data-flow-id="CLT-11">
      <Link to="/app/clients" style={{ fontSize: 13.5, color: 'var(--text-secondary)', textDecoration: 'none' }}>
        ← Back to Clients
      </Link>

      <header className="pf-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1>{c.name}</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 4 }}>{formatPhone(c.phone)}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link to={`/app/new?customerId=${c.id}`} className="pf-btn pf-btn--sm pf-btn--primary" data-flow-id="CLT-13">
              New request
            </Link>
            <button type="button" className="pf-btn pf-btn--sm pf-btn--secondary" onClick={() => setEditing(true)} data-flow-id="CLT-15">
              Edit
            </button>
            <button type="button" className="pf-btn pf-btn--sm pf-btn--secondary" onClick={archiveClient} data-flow-id="CLT-16">
              Archive
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href={`https://wa.me/${c.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="pf-btn pf-btn--sm pf-btn--secondary">
            <Icon name="send" size={14} />
            <span>WhatsApp</span>
          </a>
          <a href={`tel:${c.phone}`} className="pf-btn pf-btn--sm pf-btn--secondary">Call</a>
        </div>

        {/* Stats Row (CLT-12) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, paddingTop: 10, borderTop: '1px solid var(--border-default)' }} data-flow-id="CLT-12">
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Verified paid</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--status-success)' }}>{formatNaira(lifetimePaid.toString())}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Outstanding</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{formatNaira(c.outstandingKobo)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Jobs</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{c.jobCount}</div>
          </div>
        </div>
      </header>

      <div className="pf-tabs">
        <button type="button" className={`pf-tab-btn ${tab === 'jobs' ? 'is-active' : ''}`} onClick={() => setTab('jobs')}>
          Jobs ({jobs.length})
        </button>
        <button type="button" className={`pf-tab-btn ${tab === 'activity' ? 'is-active' : ''}`} onClick={() => setTab('activity')}>
          Activity
        </button>
      </div>

      {tab === 'jobs' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-flow-id="CLT-14">
          {jobs.length === 0 ? (
            <div className="pf-card"><p style={{ color: 'var(--text-secondary)' }}>No jobs for this client yet.</p></div>
          ) : (
            jobs.map((j) => (
              <Link
                key={j.id}
                to={`/app/jobs/${j.id}`}
                className="pf-card"
                style={{ textDecoration: 'none', color: 'inherit', padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{j.service}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{formatNaira(j.paidKobo)} paid of {formatNaira(j.totalKobo)}</div>
                </div>
                <Icon name="chevron" size={16} />
              </Link>
            ))
          )}
        </div>
      ) : (
        <div className="pf-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {timeline.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)' }}>No activity yet.</p>
          ) : (
            timeline.map((ev, idx) => (
              <div key={`${ev.at}_${idx}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, borderBottom: '1px solid var(--border-default)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{ev.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ev.service} · {formatTime(ev.at)}</div>
                </div>
                {ev.amountKobo && <strong style={{ fontSize: 13.5 }}>{formatNaira(ev.amountKobo)}</strong>}
              </div>
            ))
          )}
        </div>
      )}

      <EditCustomerDialog customer={c} open={editing} onClose={() => setEditing(false)} />
    </div>
  );
}
