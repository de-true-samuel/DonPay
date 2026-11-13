import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { describeError } from '../api/errors';
import { searchApi } from '../api/endpoints';
import type { SavedView, SearchStatus } from '../contract/contract';
import { ExportDialog } from '../features/search/ExportDialog';
import { JobFollowUp } from '../features/jobs/JobFollowUp';
import { JobRow } from '../features/jobs/JobRow';
import { isDateParam, parseStatuses, parseView, toStatusParam, toggleStatus } from '../lib/filters';
import { useDebounced, useDocumentTitle } from '../lib/hooks';
import { formatNaira } from '../lib/money';
import { formatPhone } from '../lib/phone';
import { Banner, Button, EmptyState, LinkButton, MultiChips, SearchField, Skeleton, ViewTabs } from '../ui/primitives';

type View = 'all' | SavedView;
const VIEWS: Array<{ value: View; label: string }> = [
  { value: 'all', label: 'Everything' }, { value: 'unpaid_balances', label: 'Unpaid balances' },
  { value: 'this_week', label: 'This week' }, { value: 'needs_follow_up', label: 'Needs follow-up' },
];
const STATUS_CHIPS: Array<{ value: SearchStatus; label: string }> = [
  { value: 'paid', label: 'Paid' }, { value: 'waiting', label: 'Waiting' }, { value: 'balance_due', label: 'Balance due' },
  { value: 'expired', label: 'Expired' }, { value: 'needs_review', label: 'Needs review' },
];

export function SearchPage() {
  useDocumentTitle('Search');
  const [params, setParams] = useSearchParams();
  const [exporting, setExporting] = useState(false);

  // Everything lives in the address bar, so Back, refresh and shared links all keep the same search.
  const urlQ = params.get('q') ?? '';
  const view = parseView(params.get('view'));
  const statuses = parseStatuses(params.get('status'));
  const from = isDateParam(params.get('from')) ? params.get('from')! : '';
  const to = isDateParam(params.get('to')) ? params.get('to')! : '';

  const patch = (p: Record<string, string | null>) => setParams((prev) => {
    const n = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(p)) { if (v) n.set(k, v); else n.delete(k); }
    return n;
  }, { replace: true });
  const patchRef = useRef(patch);
  patchRef.current = patch;

  const [text, setText] = useState(urlQ);
  const dq = useDebounced(text.trim(), 300);
  useEffect(() => { if (dq !== urlQ) patchRef.current({ q: dq || null }); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useInfiniteQuery({
    queryKey: ['search', urlQ, view, statuses.join(','), from, to],
    queryFn: ({ pageParam }) => searchApi.search({
      q: urlQ || undefined, view: view ?? undefined, status: toStatusParam(statuses) ?? undefined,
      from: from || undefined, to: to || undefined, limit: 20, cursor: pageParam,
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const seen = list.data?.pages[0]?.interpreted;
  const filtered = !!(urlQ || view || statuses.length || from || to);

  function clearAll() { setText(''); setParams({}, { replace: true }); }

  return (
    <>
      <header className="pd-pagehead">
        <h1>Search</h1>
        <p className="pd-sub">Find any customer, number or amount.</p>
      </header>

      <SearchField label="Search jobs" value={text} onChange={setText} placeholder="Tolu · 0803 · 25k" />
      {seen && (seen.text || seen.phone || seen.amountKobo) && (
        <p className="pd-interp" aria-label="How Paidar read your search">
          <span>Looking for</span>
          {seen.text && <b>name or service “{seen.text}”</b>}
          {seen.phone && <b>phone {formatPhone(seen.phone)}</b>}
          {seen.amountKobo && <b>amount {formatNaira(seen.amountKobo, 'auto')}</b>}
        </p>
      )}

      <ViewTabs<View> label="Saved views" value={view ?? 'all'} options={VIEWS} onChange={(v) => patch({ view: v === 'all' ? null : v })} />
      <MultiChips<SearchStatus> label="Show jobs that are" values={statuses} options={STATUS_CHIPS}
        onToggle={(s) => patch({ status: toStatusParam(toggleStatus(statuses, s)) })} />
      <details className="pd-dates" open={!!(from || to)}>
        <summary>Dates{from || to ? ` · ${from || '…'} to ${to || '…'}` : ''}</summary>
        <div className="pd-dates__row">
          <label className="pd-label" htmlFor="pd-from">From</label>
          <input id="pd-from" type="date" className="pd-input" value={from} max={to || undefined} onChange={(e) => patch({ from: e.target.value || null })} />
          <label className="pd-label" htmlFor="pd-to">To</label>
          <input id="pd-to" type="date" className="pd-input" value={to} min={from || undefined} onChange={(e) => patch({ to: e.target.value || null })} />
        </div>
      </details>

      <div className="pd-actions pd-gap">
        {filtered && <Button variant="quiet" onClick={clearAll}>Clear all</Button>}
        <Button variant="line" onClick={() => setExporting(true)}>Export CSV</Button>
      </div>

      {list.isPending && <div className="pd-stack pd-gap" aria-busy="true"><Skeleton h={68} /><Skeleton h={68} /><Skeleton h={68} /></div>}
      {list.isError && <Banner tone="bad" action={<Button variant="line" onClick={() => void list.refetch()}>Try again</Button>}>{describeError(list.error).message}</Banner>}

      {list.data && items.length === 0 && (
        filtered
          ? <EmptyState title="Nothing matches" action={<Button variant="line" onClick={clearAll}>Clear all filters</Button>}>
              Try fewer filters, part of a name, or a different amount.
            </EmptyState>
          : <EmptyState title="No jobs yet" action={<LinkButton to="/new" icon="plus">Create payment details</LinkButton>}>
              Once you have jobs, search by name, phone number or amount.
            </EmptyState>
      )}

      {items.length > 0 && (
        <ul className="pd-list pd-gap">
          {items.map((j) => (
            <li key={j.id} className="pd-result">
              <JobRow job={j} />
              <JobFollowUp job={j} />
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage && <div className="pd-more"><Button variant="line" busy={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Show more</Button></div>}

      <ExportDialog open={exporting} onClose={() => setExporting(false)} />
    </>
  );
}
