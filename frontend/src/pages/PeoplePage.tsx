import { useState } from 'react';
import { Link, useMatch } from 'react-router-dom';
import { cls } from '../lib/cls';
import { useInfiniteQuery } from '@tanstack/react-query';
import { describeError } from '../api/errors';
import { customersApi } from '../api/endpoints';
import { AddCustomerDialog, ImportDialog } from '../features/customers/CustomerDialogs';
import { useDebounced, useDocumentTitle } from '../lib/hooks';
import { formatPhone } from '../lib/phone';
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
    queryFn: ({ pageParam }) =>
      customersApi.list({ q: q || undefined, limit: 20, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <header className="pd-pagehead">
        <h1>People</h1>
        <p className="pd-sub">Your customers and what each one owes.</p>
      </header>

      {/* Directory Search Field */}
      <div style={{ marginBottom: 14 }}>
        <SearchField
          label="Search customers"
          value={text}
          onChange={setText}
          placeholder="Search by name or phone number…"
        />
      </div>

      {/* Action Toolbar — shown when items exist or when searching */}
      {(items.length > 0 || q) && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 18 }}>
          <Button icon="plus" onClick={() => setAdding(true)}>
            Add customer
          </Button>
          <Button variant="line" onClick={() => setImporting(true)}>
            Import a list
          </Button>
        </div>
      )}

      {list.isPending && (
        <div className="pd-stack pd-gap" aria-busy="true">
          <Skeleton h={68} />
          <Skeleton h={68} />
        </div>
      )}

      {list.isError && (
        <Banner
          tone="bad"
          action={
            <Button variant="line" onClick={() => void list.refetch()}>
              Try again
            </Button>
          }
        >
          {describeError(list.error).message}
        </Banner>
      )}

      {/* Empty States */}
      {list.data && items.length === 0 && (
        q ? (
          <EmptyState
            title={`No one matches “${q}”`}
            action={
              <Button variant="line" onClick={() => setAdding(true)}>
                Add them as customer
              </Button>
            }
          >
            Check the spelling, or try part of the phone number.
          </EmptyState>
        ) : (
          <EmptyState
            title="No customers yet"
            action={
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
                <Button onClick={() => setAdding(true)} icon="plus">
                  Add your first customer
                </Button>
                <Button variant="line" onClick={() => setImporting(true)}>
                  Import a list
                </Button>
              </div>
            }
          >
            Customers are saved automatically when you create payment details for a job.
            If you already keep a client list, import a CSV or add someone directly.
          </EmptyState>
        )
      )}

      {/* Customer Directory Slips */}
      {items.length > 0 && (
        <ul className="pd-list pd-gap" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
          {items.map((c) => {
            const owes = BigInt(c.outstandingKobo) > 0n;
            return (
              <li key={c.id}>
                <Link
                  to={`/people/${c.id}`}
                  className={cls('pd-slip', openId === c.id && 'is-active')}
                  style={{ textDecoration: 'none' }}
                  aria-current={openId === c.id ? 'page' : undefined}
                >
                  <div className="pd-slip__main">
                    <span className="pd-slip__name">{c.name}</span>
                    <p className="pd-slip__meta">
                      {formatPhone(c.phone)} · {c.jobCount} {c.jobCount === 1 ? 'job' : 'jobs'}
                    </p>
                  </div>
                  <div className="pd-slip__side" style={{ textAlign: 'right' }}>
                    {owes ? (
                      <div>
                        <div style={{ color: 'var(--urgent)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>
                          <Money kobo={c.outstandingKobo} size="sm" />
                        </div>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            color: 'var(--urgent)',
                            letterSpacing: '0.04em',
                          }}
                        >
                          owes
                        </span>
                      </div>
                    ) : (
                      <span style={{ fontSize: 13, color: 'var(--paper-muted)', fontWeight: 500 }}>
                        Nothing owed
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {list.hasNextPage && (
        <div className="pd-more">
          <Button
            variant="line"
            busy={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            Show more
          </Button>
        </div>
      )}

      <AddCustomerDialog open={adding} onClose={() => setAdding(false)} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
    </>
  );
}
