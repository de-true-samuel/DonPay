import type { Deps } from '../deps';
import { addDays, lagosStartOfDay } from '../domain/time';
import { financialsOf, jobInclude, toJobSummary, toPayment, toRequest, toReviewItem } from './serialize';
import type * as C from '../shared/contract';

/** The home screen: what needs the provider's attention right now. */
export async function getToday(deps: Deps, providerId: string): Promise<C.TodayResponse> {
  const now = deps.now();
  const startToday = lagosStartOfDay(now);
  const endTomorrow = addDays(startToday, 2);
  const weekAgo = addDays(now, -7);
  const cfg = deps.config;

  const [paid, waiting, dueJobs, expired, reviews, reminders] = await Promise.all([
    deps.db.payment.findMany({
      where: { providerId, receivedAt: { gte: startToday } },
      include: { job: { include: jobInclude } },
      orderBy: { receivedAt: 'desc' },
      take: 100,
    }),
    deps.db.paymentRequest.findMany({
      where: { providerId, status: 'SENT', expiresAt: { gt: now } },
      include: { job: { include: jobInclude } },
      orderBy: { expiresAt: 'asc' },
      take: 100,
    }),
    deps.db.job.findMany({
      where: {
        providerId,
        cancelledAt: null,
        balanceDueAt: { not: null, lt: endTomorrow },
        requests: { none: { status: { in: ['SCHEDULED', 'SENT'] } } },
      },
      include: jobInclude,
      orderBy: { balanceDueAt: 'asc' },
      take: 200,
    }),
    deps.db.paymentRequest.findMany({
      where: {
        providerId,
        status: 'EXPIRED',
        expiredAt: { gte: weekAgo },
        job: { cancelledAt: null, requests: { none: { status: { in: ['DRAFT', 'SCHEDULED', 'SENT'] } } } },
      },
      include: { job: { include: jobInclude } },
      orderBy: { expiredAt: 'desc' },
      take: 200,
    }),
    deps.db.reviewItem.findMany({ where: { providerId, resolvedAt: null }, orderBy: { createdAt: 'desc' }, take: 50 }),
    // BE-03: scheduled, reminder time passed, no account yet, not cancelled. Stays until the provider
    // gets payment details (status leaves SCHEDULED) or cancels.
    deps.db.paymentRequest.findMany({
      where: { providerId, status: 'SCHEDULED', scheduledFor: { lte: now }, accountNumber: null, job: { cancelledAt: null } },
      include: { job: { include: jobInclude } },
      orderBy: { scheduledFor: 'asc' },
      take: 200,
    }),
  ]);

  const balancesDue = dueJobs.filter((j) => financialsOf(j).balanceKobo > 0n).map((j) => toJobSummary(cfg, j));

  // One "send again" entry per job (its most recent expired request), only while money is still owed.
  const seenJobs = new Set<string>();
  const expiredItems: C.TodayResponse['expired'] = [];
  for (const r of expired) {
    if (seenJobs.has(r.jobId) || financialsOf(r.job).balanceKobo <= 0n) continue;
    seenJobs.add(r.jobId);
    expiredItems.push({ request: toRequest(cfg, r), job: toJobSummary(cfg, r.job) });
  }

  const result: C.TodayResponse = {
    generatedAt: now.toISOString(),
    justPaid: paid.map((p) => ({ payment: toPayment(p), job: toJobSummary(cfg, p.job) })),
    waiting: waiting.map((r) => ({ request: toRequest(cfg, r), job: toJobSummary(cfg, r.job) })),
    balancesDue,
    expired: expiredItems,
    needsReview: reviews.map(toReviewItem),
    dueReminders: reminders.map((r) => ({ request: toRequest(cfg, r), job: toJobSummary(cfg, r.job) })),
    counts: { justPaid: 0, waiting: 0, balancesDue: 0, expired: 0, needsReview: 0, dueReminders: 0 },
  };
  result.counts = {
    justPaid: result.justPaid.length,
    waiting: result.waiting.length,
    balancesDue: result.balancesDue.length,
    expired: result.expired.length,
    needsReview: result.needsReview.length,
    dueReminders: result.dueReminders.length,
  };
  return result;
}
