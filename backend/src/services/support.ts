/**
 * Read-only support view (BE-18): look up one payment request without database access.
 * Accepts the Kora reference ("KE-<id>-1"), the request id, or a receipt number ("KE-7Q2M9X").
 * Never writes anything. Guarded by the admin secret in the route.
 */
import type { Deps } from '../deps';
import { AppError, notFound } from '../errors';
import { toPayment, toRequest, toReviewItem } from './serialize';
import type * as C from '../shared/contract';

async function findRequestId(deps: Deps, reference: string): Promise<string> {
  const ref = reference.trim();
  if (/^KE-[A-Za-z0-9]{6}$/.test(ref)) {
    const matches = await deps.db.payment.findMany({ where: { id: { endsWith: ref.slice(3).toLowerCase() } }, select: { requestId: true }, take: 2 });
    if (matches.length > 1) throw new AppError('CONFLICT', 'More than one payment matches this receipt number. Use the Kora reference instead.');
    if (matches[0]?.requestId) return matches[0].requestId;
  }
  const byRef = await deps.db.paymentRequest.findUnique({ where: { koraReference: ref }, select: { id: true } });
  if (byRef) return byRef.id;
  const byId = await deps.db.paymentRequest.findUnique({ where: { id: ref }, select: { id: true } });
  if (byId) return byId.id;
  throw notFound('Payment request');
}

export async function supportLookup(deps: Deps, reference: string): Promise<C.SupportRequestView> {
  const id = await findRequestId(deps, reference);
  const r = await deps.db.paymentRequest.findUniqueOrThrow({
    where: { id },
    include: {
      provider: { select: { businessName: true } },
      job: { select: { id: true, service: true, totalKobo: true, cancelledAt: true } },
      payment: true,
      reviewItems: { orderBy: { createdAt: 'desc' } },
      claimEvents: { orderBy: { createdAt: 'desc' }, take: 20, select: { createdAt: true } },
    },
  });
  const [events, notifications] = await Promise.all([
    r.koraReference
      ? deps.db.webhookEvent.findMany({ where: { reference: r.koraReference }, orderBy: { receivedAt: 'desc' }, take: 20 })
      : Promise.resolve([]),
    deps.db.notification.findMany({
      where: {
        providerId: r.providerId,
        OR: [{ dedupeKey: { contains: r.id } }, ...(r.payment ? [{ dedupeKey: { contains: r.payment.id } }] : [])],
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);
  return {
    request: { ...toRequest(deps.config, r), koraReference: r.koraReference, providerId: r.providerId },
    businessName: r.provider.businessName,
    job: { id: r.job.id, service: r.job.service, totalKobo: r.job.totalKobo.toString(), cancelledAt: r.job.cancelledAt?.toISOString() ?? null },
    payment: r.payment ? toPayment(r.payment) : null,
    webhookEvents: events.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      signatureOk: e.signatureOk,
      receivedAt: e.receivedAt.toISOString(),
      processedAt: e.processedAt?.toISOString() ?? null,
      error: e.error,
    })),
    reviewItems: r.reviewItems.map(toReviewItem),
    claims: r.claimEvents.map((c) => ({ at: c.createdAt.toISOString() })),
    notifications: notifications.map((n) => ({
      kind: n.kind,
      createdAt: n.createdAt.toISOString(),
      sentAt: n.sentAt?.toISOString() ?? null,
      failedAt: n.failedAt?.toISOString() ?? null,
      attempts: n.attempts,
      lastError: n.lastError,
    })),
  };
}
