import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { describeError } from '../api/errors';
import { reviewApi } from '../api/endpoints';
import type { ReviewItem } from '../contract/contract';
import { ResolveDialog } from '../features/review/ResolveDialog';
import { useDocumentTitle } from '../lib/hooks';
import { REVIEW_LABEL } from '../lib/review';
import { formatDateTime } from '../lib/time';
import { Banner, Button, Chips, EmptyState, Skeleton } from '../ui/primitives';

type State = 'open' | 'resolved';

export function ReviewPage() {
  useDocumentTitle('Needs review');
  const [state, setState] = useState<State>('open');
  const q = useInfiniteQuery({
    queryKey: ['review', state],
    queryFn: ({ pageParam }) => reviewApi.list({ state, limit: 20, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <header className="pd-pagehead"><h1>Needs review</h1><p className="pd-sub">Payments that didn’t go to plan, waiting for you to decide.</p></header>
      <Chips<State> label="Show" value={state} onChange={setState} options={[{ value: 'open', label: 'Open' }, { value: 'resolved', label: 'Resolved' }]} />

      {q.isPending && <div className="pd-stack pd-gap" aria-busy="true"><Skeleton h={96} /><Skeleton h={96} /></div>}
      {q.isError && <Banner tone="bad" action={<Button variant="line" onClick={() => void q.refetch()}>Try again</Button>}>{describeError(q.error).message}</Banner>}

      {q.data && items.length === 0 && (
        <EmptyState title={state === 'open' ? 'All clear' : 'Nothing resolved yet'}>
          {state === 'open' ? 'Nothing needs your decision. If a payment arrives late or for the wrong amount, it will show up here.' : 'Items you deal with appear here, with what you did.'}
        </EmptyState>
      )}

      <ul className="pd-list pd-gap">{items.map((r) => <li key={r.id}><ReviewCard item={r} /></li>)}</ul>
      {q.hasNextPage && <div className="pd-more"><Button variant="line" busy={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Show more</Button></div>}
    </>
  );
}

function ReviewCard({ item }: { item: ReviewItem }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="pd-rcard">
      <h2>{REVIEW_LABEL[item.kind]}</h2>
      <p>{item.message}</p>
      <p className="pd-hint">{formatDateTime(item.createdAt)}</p>
      {item.resolvedAt ? (
        <p className="pd-rcard__done"><strong>Dealt with</strong> {formatDateTime(item.resolvedAt)}{item.resolution ? `: ${item.resolution}` : ''}</p>
      ) : (
        <div className="pd-actions">
          <Button onClick={() => setOpen(true)}>Resolve</Button>
        </div>
      )}
      {item.jobId && <p className="pd-hint"><Link to={`/jobs/${item.jobId}`}>Open the job</Link></p>}
      {!item.resolvedAt && <ResolveDialog item={item} open={open} onClose={() => setOpen(false)} />}
    </article>
  );
}
