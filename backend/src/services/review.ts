import type { Deps } from '../deps';
import { notFound } from '../errors';
import { cancelRequest } from './requests';
import { toReviewItem } from './serialize';
import type * as C from '../shared/contract';

export async function listReview(
  deps: Deps,
  providerId: string,
  opts: { state: 'open' | 'resolved'; limit: number; cursor?: string },
): Promise<C.Page<C.ReviewItem>> {
  const rows = await deps.db.reviewItem.findMany({
    where: { providerId, resolvedAt: opts.state === 'open' ? null : { not: null } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: opts.limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > opts.limit;
  const items = rows.slice(0, opts.limit);
  return { items: items.map(toReviewItem), nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

export async function resolveReview(
  deps: Deps,
  providerId: string,
  id: string,
  input: { resolution: string; cancelRequestId?: string },
): Promise<C.ReviewItem> {
  const item = await deps.db.reviewItem.findFirst({ where: { id, providerId } });
  if (!item) throw notFound('Review item');
  if (input.cancelRequestId) await cancelRequest(deps, providerId, input.cancelRequestId);
  const updated = await deps.db.reviewItem.update({
    where: { id },
    data: { resolvedAt: item.resolvedAt ?? deps.now(), resolution: input.resolution },
  });
  return toReviewItem(updated);
}
