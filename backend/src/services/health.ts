/**
 * Operational health (BE-14, BE-17): backlog sizes and ages that monitoring alerts on.
 * Served by GET /api/admin/health and logged by the cron sweep as `monitor.alert` (error level)
 * whenever a threshold is crossed, so a Workers Logs alert on that event pages a human.
 */
import type { Deps } from '../deps';
import { RECONCILE_GRACE_MS } from './reconcile';

export const THRESHOLDS = {
  unprocessedWebhooks: 20,
  oldestUnprocessedWebhookMinutes: 10,
  unsentNotifications: 50,
  oldestUnsentNotificationMinutes: 10,
  reconciliationBacklog: 200,
  oldestReconciliationMinutes: 10,
  deadLettered24h: 1,
} as const;

export interface HealthReport {
  ok: boolean;
  alerts: string[];
  unprocessedWebhooks: number;
  oldestUnprocessedWebhookAt: string | null;
  unsentNotifications: number;
  oldestUnsentNotificationAt: string | null;
  failedNotifications24h: number;
  reconciliationBacklog: number;
  oldestReconciliationDueAt: string | null;
  deadLetteredVerifications24h: number;
  openReviewItems: number;
  unattributedReviewItems: number;
  deadLetterHint: string;
}

const minutesSince = (d: Date | null | undefined, now: Date) => (d ? (now.getTime() - d.getTime()) / 60_000 : 0);

export async function getHealthReport(deps: Deps): Promise<HealthReport> {
  const db = deps.db;
  const now = deps.now();
  const dayAgo = new Date(now.getTime() - 24 * 3_600_000);
  const staleCheck = new Date(now.getTime() - 5 * 60_000);
  // Requests reconciliation should have looked at in the last 5 minutes but hasn't.
  const reconcileWhere = {
    status: { in: ['SENT', 'EXPIRED'] as ('SENT' | 'EXPIRED')[] },
    expiresAt: { gt: new Date(now.getTime() - RECONCILE_GRACE_MS) },
    sentAt: { lt: staleCheck },
    OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: staleCheck } }],
  };
  const [webhooks, oldestWebhook, unsent, oldestUnsent, failed, backlog, oldestBacklog, deadLettered, openReview, unattributed] = await Promise.all([
    db.webhookEvent.count({ where: { processedAt: null, signatureOk: true } }),
    db.webhookEvent.findFirst({ where: { processedAt: null, signatureOk: true }, orderBy: { receivedAt: 'asc' }, select: { receivedAt: true } }),
    db.notification.count({ where: { sentAt: null, failedAt: null } }),
    db.notification.findFirst({ where: { sentAt: null, failedAt: null }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    db.notification.count({ where: { failedAt: { gte: dayAgo } } }),
    db.paymentRequest.count({ where: reconcileWhere }),
    db.paymentRequest.findFirst({ where: reconcileWhere, orderBy: { sentAt: 'asc' }, select: { sentAt: true, lastCheckedAt: true } }),
    db.reviewItem.count({ where: { kind: 'VERIFICATION_FAILED', createdAt: { gte: dayAgo } } }),
    db.reviewItem.count({ where: { resolvedAt: null } }),
    db.reviewItem.count({ where: { resolvedAt: null, providerId: null } }),
  ]);

  const alerts: string[] = [];
  const t = THRESHOLDS;
  if (webhooks > t.unprocessedWebhooks) alerts.push(`${webhooks} unprocessed webhooks`);
  if (minutesSince(oldestWebhook?.receivedAt, now) > t.oldestUnprocessedWebhookMinutes) alerts.push('oldest unprocessed webhook is over 10 minutes old');
  if (unsent > t.unsentNotifications) alerts.push(`${unsent} unsent notifications`);
  if (minutesSince(oldestUnsent?.createdAt, now) > t.oldestUnsentNotificationMinutes) alerts.push('oldest unsent notification is over 10 minutes old');
  if (backlog > t.reconciliationBacklog) alerts.push(`${backlog} requests waiting for reconciliation`);
  const oldestDue = oldestBacklog ? (oldestBacklog.lastCheckedAt ?? oldestBacklog.sentAt) : null;
  if (minutesSince(oldestDue, now) > t.oldestReconciliationMinutes) alerts.push('reconciliation is falling behind (a request has not been checked for over 10 minutes)');
  if (deadLettered >= t.deadLettered24h) alerts.push(`${deadLettered} payment verifications dead-lettered in the last 24 hours`);

  return {
    ok: alerts.length === 0,
    alerts,
    unprocessedWebhooks: webhooks,
    oldestUnprocessedWebhookAt: oldestWebhook?.receivedAt.toISOString() ?? null,
    unsentNotifications: unsent,
    oldestUnsentNotificationAt: oldestUnsent?.createdAt.toISOString() ?? null,
    failedNotifications24h: failed,
    reconciliationBacklog: backlog,
    oldestReconciliationDueAt: oldestDue?.toISOString() ?? null,
    deadLetteredVerifications24h: deadLettered,
    openReviewItems: openReview,
    unattributedReviewItems: unattributed,
    deadLetterHint: 'Dead-lettered messages become VERIFICATION_FAILED review items or failed notifications; also check the *-dlq queue depth in the Cloudflare dashboard',
  };
}
