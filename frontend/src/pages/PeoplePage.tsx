import { useState } from 'react';
import { Link, useMatch } from 'react-router-dom';
import { cls } from '../lib/cls';
import { useInfiniteQuery } from '@tanstack/react-query';
import { describeError } from '../api/errors';
import { customersApi } from '../api/endpoints';
import { AddCustomerDialog, ImportDialog } from '../features/customers/CustomerDialogs';
import { useDebounced, useDocumentTitle } from '../lib/hooks';
import { formatPhone } from '../lib/phone';
import { timeAgo } from '../lib/time';
import { Money } from '../ui/Money';
import { Banner, Button, EmptyState, SearchField, Skeleton } from '../ui/primitives';

export function PeoplePage() {
  useDocumentTitle('People');
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const q = useDebounced(text.trim(), 300);
  const openId = useMatch('/people/:id')?.params.id;
  const list = useInfiniteQuery({
    queryKey: ['customers', q],
    queryFn: ({ pageParam }) => customersApi.list({ q: q || undefined, limit: 20, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <header className="pd-pagehead"><h1>People</h1><p className="pd-sub">Your customers and what each one owes.</p></header>
      <div className="pd-actions pd-gap">
        <Button icon="plus" onClick={() => setAdding(true)}>Add customer</Button>
        <Button variant="line" onClick={() => setImporting(true)}>Import a list</Button>
      </div>
      <SearchField label="Search customers" value={text} onChange={setText} placeholder="Name or phone number" />

      {list.isPending && <div className="pd-stack pd-gap" aria-busy="true"><Skeleton h={68} /><Skeleton h={68} /></div>}
      {list.isError && <Banner tone="bad" action={<Button variant="line" onClick={() => void list.refetch()}>Try again</Button>}>{describeError(list.error).message}</Banner>}

      {list.data && items.length === 0 && (
        q
          ? <EmptyState title={`No one matches “${q}”`} action={<Button variant="line" onClick={() => setAdding(true)}>Add them</Button>}>Check the spelling, or try part of the phone number.</EmptyState>
          : <EmptyState title="No customers yet" action={<Button onClick={() => setAdding(true)} icon="plus">Add your first customer</Button>}>
              Customers are also saved automatically when you create a request. If you already keep a list, import it.
            </EmptyState>
      )}

      {items.length > 0 && (
        <ul className="pd-list pd-gap">
          {items.map((c) => {
            const owes = BigInt(c.outstandingKobo) > 0n;
            return (
              <li key={c.id}>
                <Link to={`/people/${c.id}`} className={cls('pd-jobrow', openId === c.id && 'is-active')} aria-current={openId === c.id ? 'page' : undefined}>
                  <div className="pd-jobrow__main">
                    <strong>{c.name}</strong>
                    <p>{formatPhone(c.phone)}</p>
                  </div>
                  <div className="pd-jobrow__side">
                    {owes ? <><Money kobo={c.outstandingKobo} size="md" /><span className="pd-hint">owes</span></> : <span className="pd-hint">Nothing owed</span>}
                    <span className="pd-hint">{c.jobCount} {c.jobCount === 1 ? 'job' : 'jobs'} · {timeAgo(c.lastActivityAt)}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {list.hasNextPage && <div className="pd-more"><Button variant="line" busy={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Show more</Button></div>}

      <AddCustomerDialog open={adding} onClose={() => setAdding(false)} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
    </>
  );
}
