import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { describeError } from '../api/errors';
import { jobsApi } from '../api/endpoints';
import type { JobStatus } from '../contract/contract';
import { JobRow } from '../features/jobs/JobRow';
import { useDocumentTitle } from '../lib/hooks';
import { Banner, Button, Chips, EmptyState, LinkButton, Skeleton } from '../ui/primitives';

type Filter = 'ALL' | JobStatus;
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'ALL', label: 'All' }, { value: 'NOT_STARTED', label: 'Not started' },
  { value: 'PART_PAID', label: 'Part-paid' }, { value: 'FULLY_PAID', label: 'Fully paid' }, { value: 'CANCELLED', label: 'Cancelled' },
];

export function JobsPage() {
  useDocumentTitle('Jobs');
  const [filter, setFilter] = useState<Filter>('ALL');
  const q = useInfiniteQuery({
    queryKey: ['jobs', filter],
    queryFn: ({ pageParam }) => jobsApi.list({ status: filter === 'ALL' ? undefined : filter, limit: 20, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <header className="pd-pagehead"><h1>Jobs</h1><p className="pd-sub">Every agreement, with what’s paid and what’s left.</p></header>
      <Chips label="Filter jobs by status" value={filter} options={FILTERS} onChange={setFilter} />

      {q.isPending && <div className="pd-stack pd-gap" aria-busy="true"><Skeleton h={68} /><Skeleton h={68} /><Skeleton h={68} /></div>}
      {q.isError && <Banner tone="bad" action={<Button variant="line" onClick={() => void q.refetch()}>Try again</Button>}>{describeError(q.error).message}</Banner>}

      {q.data && items.length === 0 && (
        <EmptyState title={filter === 'ALL' ? 'No jobs yet' : 'Nothing here'}
          action={filter === 'ALL' ? <LinkButton to="/new" icon="plus">Start with payment details</LinkButton> : <Button variant="line" onClick={() => setFilter('ALL')}>Show all jobs</Button>}>
          {filter === 'ALL' ? 'A job holds one customer’s agreement: the service, the total, and any deposit and balance.' : 'No jobs match this filter.'}
        </EmptyState>
      )}

      {items.length > 0 && (
        <ul className="pd-list pd-gap">{items.map((j) => <li key={j.id}><JobRow job={j} /></li>)}</ul>
      )}
      {q.hasNextPage && (
        <div className="pd-more"><Button variant="line" busy={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Show more</Button></div>
      )}
    </>
  );
}
