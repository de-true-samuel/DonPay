import { useMemo, useState } from 'react';
import { Link, useMatch } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { describeError } from '../api/errors';
import { customersApi } from '../api/endpoints';
import { AddCustomerDialog, ImportDialog } from '../features/customers/CustomerDialogs';
import { useDebounced, useDocumentTitle } from '../lib/hooks';
import { formatNaira } from '../lib/money';
import { formatPhone } from '../lib/phone';
import { Icon } from '../ui/Icon';
import { Banner, Button, Skeleton } from '../ui/primitives';

export function PeoplePage() {
  useDocumentTitle('Clients');
  const [text, setText] = useState('');
  const [sort, setSort] = useState<'name' | 'recent' | 'outstanding'>('name');
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const q = useDebounced(text.trim(), 300);
  const openId = useMatch('/app/clients/:id')?.params.id;

  const list = useInfiniteQuery({
    queryKey: ['customers', q],
    queryFn: ({ pageParam }) => customersApi.list({ q: q || undefined, limit: 40, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const rawItems = list.data?.pages.flatMap((p) => p.items) ?? [];

  const archivedSet = useMemo(() => {
    try {
      const raw = localStorage.getItem('paidar.clients.archived');
      return new Set<string>(raw ? JSON.parse(raw) : []);
    } catch { return new Set<string>(); }
  }, []);

  const items = useMemo(() => {
    return rawItems
      .filter((c) => showArchived || !archivedSet.has(c.id))
      .sort((a, b) => {
        if (sort === 'recent') return Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt);
        if (sort === 'outstanding') return Number(BigInt(b.outstandingKobo) - BigInt(a.outstandingKobo));
        return a.name.localeCompare(b.name);
      });
  }, [rawItems, sort, showArchived, archivedSet]);

  return (
    <div data-flow-id="CLT-00">
      <div className="pf-page-head">
        <div>
          <h1>Clients</h1>
          <p className="pf-page-head__sub">Your client directory, contact info, and outstanding balances.</p>
        </div>
        <div className="pf-page-head__actions">
          <button type="button" className="pf-btn pf-btn--secondary" onClick={() => setImporting(true)}>
            Import CSV
          </button>
          <button type="button" className="pf-btn pf-btn--primary" onClick={() => setAdding(true)} data-flow-id="CLT-02">
            <Icon name="plus" size={16} />
            <span>Add client</span>
          </button>
        </div>
      </div>

      {/* Search, Sort & Show archived */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <input
          type="search"
          className="pd-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search name, phone, or email…"
          aria-label="Search clients"
          data-flow-id="CLT-01"
          style={{ flex: 1, minWidth: 220, maxWidth: 340, minHeight: 42 }}
        />
        <select
          aria-label="Sort clients"
          className="pd-input"
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          data-flow-id="CLT-03"
          style={{ width: 'auto', minHeight: 42, fontSize: 13 }}
        >
          <option value="name">Sort: Name</option>
          <option value="recent">Sort: Most recent job</option>
          <option value="outstanding">Sort: Outstanding amount</option>
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }} data-flow-id="CLT-04">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} style={{ accentColor: 'var(--volt)' }} />
          <span>Show archived</span>
        </label>
      </div>

      {list.isPending && (
        <div className="pd-stack pd-gap" aria-busy="true">
          <Skeleton h={64} />
          <Skeleton h={64} />
        </div>
      )}

      {list.isError && (
        <Banner tone="bad" action={<Button variant="line" onClick={() => void list.refetch()}>Try again</Button>}>
          {describeError(list.error).message}
        </Banner>
      )}

      {list.data && items.length === 0 && (
        <div className="pf-card" style={{ textAlign: 'center', padding: 36 }} data-flow-id="CLT-07">
          <p style={{ color: 'var(--ink-2)', marginBottom: 14 }}>
            {q ? `No client matches “${q}”.` : "No clients yet. They're added when you create a request."}
          </p>
          <button type="button" className="pf-btn pf-btn--primary" onClick={() => setAdding(true)}>
            Add a client
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((c) => {
            const owes = BigInt(c.outstandingKobo) > 0n;
            const isArchived = archivedSet.has(c.id);
            return (
              <Link
                key={c.id}
                to={`/app/clients/${c.id}`}
                className={`pd-jobrow ${c.id === openId ? 'is-active' : ''}`}
                data-flow-id="CLT-05"
                style={{ opacity: isArchived ? 0.6 : 1 }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>
                    {c.name} {isArchived && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>(Archived)</span>}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {formatPhone(c.phone)} · {c.jobCount} {c.jobCount === 1 ? 'job' : 'jobs'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 600, color: owes ? 'var(--status-warning)' : 'var(--status-success)' }}>
                    {owes ? `${formatNaira(c.outstandingKobo)} due` : 'Settled'}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {list.hasNextPage && (
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <Button variant="line" busy={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Show more</Button>
        </div>
      )}

      <AddCustomerDialog open={adding} onClose={() => setAdding(false)} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
    </div>
  );
}
