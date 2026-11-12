/**
 * Cron sweep and the scheduled-work handlers (ARCHITECTURE.md §6.4–6.6, §7).
 * The sweep only runs cheap indexed selects and enqueues work; handlers do the heavy lifting.
 */
import type { Deps } from '../deps';
import { computeJobFinancials } from '../domain/job';
import { balanceDuePrompt, dailyDigest, scheduledSendPrompt } from '../domain/messages';
import { addDays, lagosDateString, lagosMinuteOfDay, lagosStartOfDay } from '../domain/time';
import { getHealthReport } from './health';
import { createNotification, enqueueNotifications } from './notifications';
import { recordVerifiedCharge } from './payments';
import { RECONCILE_GRACE_MS, RECONCILE_INTERVAL_MS } from './reconcile';

const EXPIRY_GRACE_MS = 2 * 60 * 1000;
const OUTBOX_STALE_MS = 2 * 60 * 1000;
const WEBHOOK_STALE_MS = 2 * 60 * 1000;
const BATCH = 100;

export interface SweepReport {
  expiryChecks: number;
  scheduledPrompts: number;
  followUpPrompts: number;
  balancePrompts: number;
  digests: number;
  outboxRetries: number;
  webhookRetries: number;
  reconciliations: number;
  idempotencyKeysPurged: number;
}

export async function runSweep(deps: Deps): Promise<SweepReport> {
  const now = deps.now();
  const report: SweepReport = {
    expiryChecks: 0,
    scheduledPrompts: 0,
    followUpPrompts: 0,
    balancePrompts: 0,
    digests: 0,
    outboxRetries: 0,
    webhookRetries: 0,
    reconciliations: 0,
    idempotencyKeysPurged: 0,
  };

  // 1. Requests past expiry (+ grace): ask Kora before marking EXPIRED.
  const expiring = await deps.db.paymentRequest.findMany({
    where: { status: 'SENT', expiresAt: { lt: new Date(now.getTime() - EXPIRY_GRACE_MS) } },
    select: { id: true },
    take: BATCH,
  });
  for (const r of expiring) await deps.queue.send({ type: 'request.checkExpiry', requestId: r.id });
  report.expiryChecks = expiring.length;

  // 2. Scheduled requests now due → remind the provider (BE-04). No account is created here: it is
  //    created only when the provider taps "Get payment details". The request also shows in
  //    Today → dueReminders until then.
  const due = await deps.db.paymentRequest.findMany({
    where: { status: 'SCHEDULED', scheduledFor: { lte: now }, promptedAt: null },
    include: { job: { include: { customer: { select: { name: true } } } } },
    take: BATCH,
  });
  const notificationIds: string[] = [];
  for (const r of due) {
    const id = await deps.db.$transaction(async (tx) => {
      const { count } = await tx.paymentRequest.updateMany({ where: { id: r.id, promptedAt: null }, data: { promptedAt: now } });
      if (!count) return null;
      const n = await createNotification(tx, {
        providerId: r.providerId,
        kind: 'SCHEDULED_SEND_PROMPT',
        dedupeKey: `SCHEDULED_SEND_PROMPT:${r.id}:${r.scheduledFor?.toISOString()}`,
        payload: {
          text: scheduledSendPrompt({ customerName: r.job.customer.name, service: r.job.service, kind: r.kind, amountKobo: r.amountKobo }),
          buttons: [[{ text: 'Open job', url: `${deps.config.frontendUrl}/jobs/${r.jobId}` }]],
        },
      });
      return n.created ? n.id : null;
    });
    if (id) notificationIds.push(id);
  }
  report.scheduledPrompts = due.length;

  // 2b. Optional next-morning follow-up for reminders still not acted on (BE-04, off by default).
  const followUpMinute = deps.config.reminderFollowUpMinute;
  const startOfToday = lagosStartOfDay(now);
  if (followUpMinute != null && lagosMinuteOfDay(now) >= followUpMinute) {
    const stillDue = await deps.db.paymentRequest.findMany({
      where: { status: 'SCHEDULED', promptedAt: { lt: startOfToday }, followUpPromptedAt: null, job: { cancelledAt: null } },
      include: { job: { include: { customer: { select: { name: true } } } } },
      take: BATCH,
    });
    for (const r of stillDue) {
      const id = await deps.db.$transaction(async (tx) => {
        const { count } = await tx.paymentRequest.updateMany({ where: { id: r.id, followUpPromptedAt: null }, data: { followUpPromptedAt: now } });
        if (!count) return null;
        const n = await createNotification(tx, {
          providerId: r.providerId,
          kind: 'SCHEDULED_SEND_PROMPT',
          dedupeKey: `SCHEDULED_SEND_FOLLOW_UP:${r.id}`,
          payload: {
            text: scheduledSendPrompt({ customerName: r.job.customer.name, service: r.job.service, kind: r.kind, amountKobo: r.amountKobo, followUp: true }),
            buttons: [[{ text: 'Open job', url: `${deps.config.frontendUrl}/jobs/${r.jobId}` }]],
          },
        });
        return n.created ? n.id : null;
      });
      if (id) notificationIds.push(id);
    }
    report.followUpPrompts = stillDue.length;
  }

  // 3. Balance due today (Lagos), no open request, still owed, not yet prompted.
  const startToday = lagosStartOfDay(now);
  const balanceJobs = await deps.db.job.findMany({
    where: {
      cancelledAt: null,
      balancePromptedAt: null,
      balanceDueAt: { gte: startToday, lt: addDays(startToday, 1) },
      requests: { none: { status: { in: ['DRAFT', 'SCHEDULED', 'SENT'] } } },
    },
    include: { customer: { select: { name: true } }, payments: { select: { amountKobo: true, source: true } } },
    take: BATCH,
  });
  for (const j of balanceJobs) {
    const f = computeJobFinancials({ ...j, payments: j.payments });
    const id = await deps.db.$transaction(async (tx) => {
      const { count } = await tx.job.updateMany({ where: { id: j.id, balancePromptedAt: null }, data: { balancePromptedAt: now } });
      if (!count || f.balanceKobo <= 0n) return null;
      const n = await createNotification(tx, {
        providerId: j.providerId,
        kind: 'BALANCE_DUE_PROMPT',
        dedupeKey: `BALANCE_DUE_PROMPT:${j.id}:${lagosDateString(now)}`,
        payload: {
          text: balanceDuePrompt({ customerName: j.customer.name, service: j.service, balanceKobo: f.balanceKobo, dueAt: j.balanceDueAt!, now }),
          buttons: [[{ text: 'Open job', url: `${deps.config.frontendUrl}/jobs/${j.id}?balance=1` }]],
        },
      });
      return n.created ? n.id : null;
    });
    if (id) notificationIds.push(id);
  }
  report.balancePrompts = balanceJobs.length;
  await enqueueNotifications(deps, notificationIds);

  // 4. Daily digests. "<= now" (not "== now") so a missed cron tick still sends today's digest;
  //    the handler's conditional update guarantees once per day.
  const today = lagosDateString(now);
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  const digestProviders = await deps.db.provider.findMany({
    where: {
      digestMinuteOfDay: { not: null, lte: lagosMinuteOfDay(now) },
      telegramChatId: { not: null },
      OR: [{ lastDigestOn: null }, { lastDigestOn: { lt: todayDate } }],
    },
    select: { id: true },
    take: BATCH,
  });
  for (const p of digestProviders) await deps.queue.send({ type: 'digest.build', providerId: p.id, date: today });
  report.digests = digestProviders.length;

  // 5. Outbox recovery: notifications whose enqueue was lost.
  const stale = await deps.db.notification.findMany({
    where: { sentAt: null, failedAt: null, attempts: { lt: 10 }, createdAt: { lt: new Date(now.getTime() - OUTBOX_STALE_MS) } },
    select: { id: true },
    take: BATCH,
  });
  for (const n of stale) await deps.queue.send({ type: 'notify.send', notificationId: n.id });
  report.outboxRetries = stale.length;

  // 6. Webhooks stored but never processed (queue message lost): verify again.
  const stuck = await deps.db.webhookEvent.findMany({
    where: { processedAt: null, signatureOk: true, reference: { not: null }, receivedAt: { lt: new Date(now.getTime() - WEBHOOK_STALE_MS) } },
    select: { id: true, reference: true },
    take: BATCH,
  });
  for (const w of stuck) await deps.queue.send({ type: 'kora.verify', reference: w.reference!, webhookEventId: w.id });
  report.webhookRetries = stuck.length;

  // 7. Background reconciliation (BE-14): every waiting request, and every request until 30 minutes
  //    after its expiry, is re-queried with Kora at most every 2 minutes. Catches lost or delayed
  //    webhooks. lastCheckedAt is stamped here so the next tick doesn't enqueue the same rows.
  const checkBefore = new Date(now.getTime() - RECONCILE_INTERVAL_MS);
  const toReconcile = await deps.db.paymentRequest.findMany({
    where: {
      status: { in: ['SENT', 'EXPIRED'] },
      koraReference: { not: null },
      expiresAt: { gt: new Date(now.getTime() - RECONCILE_GRACE_MS) },
      sentAt: { lt: checkBefore },
      OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: checkBefore } }],
    },
    orderBy: [{ lastCheckedAt: { sort: 'asc', nulls: 'first' } }],
    select: { id: true },
    take: BATCH,
  });
  if (toReconcile.length) {
    await deps.db.paymentRequest.updateMany({ where: { id: { in: toReconcile.map((r) => r.id) } }, data: { lastCheckedAt: now } });
    for (const r of toReconcile) await deps.queue.send({ type: 'request.recheck', requestId: r.id });
  }
  report.reconciliations = toReconcile.length;

  // 8. Idempotency keys older than 24 hours (BE-09).
  report.idempotencyKeysPurged = (await deps.db.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } })).count;

  // 9. Monitoring: every 5 minutes, log an error-level event when a backlog builds (BE-14, BE-17).
  if (lagosMinuteOfDay(now) % 5 === 0) {
    const health = await getHealthReport(deps);
    if (!health.ok) deps.log.error('monitor.alert', { ...health, deadLetterHint: undefined });
  }

  if (Object.values(report).some((v) => v > 0)) deps.log.info('cron.sweep', { ...report });
  return report;
}

export type ExpiryOutcome = 'not_due' | 'expired' | 'paid' | 'skipped';

/** A verified payment always wins the race against expiry. */
export async function checkExpiry(deps: Deps, requestId: string): Promise<ExpiryOutcome> {
  const r = await deps.db.paymentRequest.findUnique({ where: { id: requestId } });
  if (!r || r.status !== 'SENT' || !r.koraReference) return 'skipped';
  const now = deps.now();
  if (r.expiresAt && r.expiresAt.getTime() > now.getTime()) return 'not_due';
  const charge = await deps.kora.queryCharge(r.koraReference);
  if (charge?.state === 'success') {
    await recordVerifiedCharge(deps, charge, null);
    return 'paid';
  }
  const { count } = await deps.db.paymentRequest.updateMany({ where: { id: r.id, status: 'SENT' }, data: { status: 'EXPIRED', expiredAt: now } });
  if (count) deps.log.info('request.expired', { requestId: r.id, koraReference: r.koraReference, providerId: r.providerId });
  return count ? 'expired' : 'skipped';
}

export async function buildDigest(deps: Deps, providerId: string, date: string): Promise<'sent' | 'skipped'> {
  const dateValue = new Date(`${date}T00:00:00.000Z`);
  const { count } = await deps.db.provider.updateMany({
    where: { id: providerId, OR: [{ lastDigestOn: null }, { lastDigestOn: { lt: dateValue } }] },
    data: { lastDigestOn: dateValue },
  });
  if (!count) return 'skipped';

  const now = deps.now();
  const startToday = lagosStartOfDay(now);
  const [provider, paid, waiting, owing, reviews] = await Promise.all([
    deps.db.provider.findUniqueOrThrow({ where: { id: providerId }, select: { businessName: true } }),
    deps.db.payment.findMany({
      where: { providerId, receivedAt: { gte: startToday } },
      include: { job: { select: { customer: { select: { name: true } } } } },
      orderBy: { receivedAt: 'asc' },
    }),
    deps.db.paymentRequest.findMany({
      where: { providerId, status: 'SENT', expiresAt: { gt: now } },
      include: { job: { select: { customer: { select: { name: true } } } } },
    }),
    deps.db.job.findMany({
      where: { providerId, cancelledAt: null, requests: { none: { status: { in: ['SCHEDULED', 'SENT'] } } } },
      include: {
        customer: { select: { name: true } },
        payments: { select: { amountKobo: true, source: true } },
        _count: { select: { requests: { where: { status: 'EXPIRED' } } } },
      },
      take: 500,
    }),
    deps.db.reviewItem.count({ where: { providerId, resolvedAt: null } }),
  ]);

  const endToday = addDays(startToday, 1);
  const followUps: { customerName: string; reason: string }[] = [];
  for (const j of owing) {
    const f = computeJobFinancials({ ...j, payments: j.payments });
    if (f.balanceKobo <= 0n) continue;
    if (j.balanceDueAt && j.balanceDueAt < endToday) followUps.push({ customerName: j.customer.name, reason: `balance due for ${j.service}` });
    else if (j._count.requests > 0) followUps.push({ customerName: j.customer.name, reason: `request expired for ${j.service}` });
  }

  const text = dailyDigest({
    businessName: provider.businessName,
    paidToday: paid.map((p) => ({ customerName: p.job.customer.name, amountKobo: p.amountKobo })),
    waiting: waiting.map((w) => ({ customerName: w.job.customer.name, amountKobo: w.amountKobo })),
    followUps,
    needsReview: reviews,
  });
  const n = await deps.db.$transaction((tx) =>
    createNotification(tx, {
      providerId,
      kind: 'DIGEST',
      dedupeKey: `DIGEST:${providerId}:${date}`,
      payload: { text, buttons: [[{ text: 'Open Today', url: `${deps.config.frontendUrl}/` }]] },
    }),
  );
  if (n.created) await enqueueNotifications(deps, [n.id]);
  return 'sent';
}
