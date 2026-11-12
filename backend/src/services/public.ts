/**
 * Customer-facing views of one request (the payment page, BE-13) and the "I've paid" claim (BE-06).
 * Never exposes phone numbers of customers, internal ids, or anything about other requests.
 */
import type { Deps } from '../deps';
import { customerClaimAlert, firstName } from '../domain/messages';
import { koboToNairaString } from '../domain/money';
import { receiptNumber } from '../domain/tokens';
import { AppError, notFound } from '../errors';
import { sha256Hex } from '../integrations/kora/signature';
import { createNotification, enqueueNotifications } from './notifications';
import { financialsOf } from './serialize';
import type * as C from '../shared/contract';

const CLAIM_WINDOW_MS = 10 * 60 * 1000;
export const CLAIMS_PER_WINDOW = 3;

async function loadPublic(deps: Deps, publicToken: string) {
  const r = await deps.db.paymentRequest.findUnique({
    where: { publicToken },
    include: {
      provider: { select: { businessName: true, phoneE164: true } },
      payment: true,
      job: {
        select: {
          service: true,
          totalKobo: true,
          plan: true,
          depositKobo: true,
          readyRule: true,
          cancelledAt: true,
          balanceDueAt: true,
          customer: { select: { name: true } },
          payments: { select: { amountKobo: true, source: true } },
        },
      },
    },
  });
  if (!r) throw notFound('Payment request');
  return r;
}
type PublicRow = Awaited<ReturnType<typeof loadPublic>>;

/** A SENT request past its expiry reads as expired, even before the cron sweep marks it. */
function effectiveStatus(r: Pick<PublicRow, 'status' | 'expiresAt'>, now: Date): C.RequestStatus {
  return r.status === 'SENT' && r.expiresAt && r.expiresAt <= now ? 'EXPIRED' : r.status;
}

const STATE: Record<C.RequestStatus, C.PublicState> = {
  SENT: 'waiting',
  PAID: 'paid',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
  DRAFT: 'not_ready',
  SCHEDULED: 'not_ready',
};

export async function getPublicRequest(deps: Deps, publicToken: string): Promise<C.PublicRequest> {
  const r = await loadPublic(deps, publicToken);
  const now = deps.now();
  const status = effectiveStatus(r, now);
  const showAccount = status === 'SENT';
  const f = financialsOf(r.job);
  return {
    status,
    serverNow: now.toISOString(),
    businessName: r.provider.businessName,
    businessPhone: r.provider.phoneE164,
    customerFirstName: firstName(r.job.customer.name),
    service: r.job.service,
    kind: r.kind,
    amountKobo: r.amountKobo.toString(),
    amountPlain: koboToNairaString(r.amountKobo),
    bankName: showAccount ? r.bankName : null,
    accountNumber: showAccount ? r.accountNumber : null,
    accountName: showAccount ? r.accountName : null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    paidAt: r.paidAt?.toISOString() ?? null,
    receipt: r.payment
      ? {
          amountKobo: r.payment.amountKobo.toString(),
          paidAt: r.payment.receivedAt.toISOString(),
          reference: receiptNumber(r.payment.id),
          jobTotalKobo: r.job.totalKobo.toString(),
          jobPaidKobo: f.paidKobo.toString(),
          jobBalanceKobo: (f.balanceKobo > 0n ? f.balanceKobo : 0n).toString(),
          balanceDueAt: f.balanceKobo > 0n ? (r.job.balanceDueAt?.toISOString() ?? null) : null,
        }
      : null,
  };
}

/** The small JSON the payment page polls (contract 1.1.0 §11). */
export async function getPublicStatus(deps: Deps, publicToken: string): Promise<C.PublicStatus> {
  const r = await loadPublic(deps, publicToken);
  const now = deps.now();
  const state = STATE[effectiveStatus(r, now)];
  const out: C.PublicStatus = { state, serverNow: now.toISOString(), expiresAt: r.expiresAt?.toISOString() ?? null };
  if (state === 'paid' && r.payment) {
    const f = financialsOf(r.job);
    out.receipt = {
      amountKobo: Number(r.payment.amountKobo),
      reference: receiptNumber(r.payment.id),
      paidAt: r.payment.receivedAt.toISOString(),
      ...(f.balanceKobo > 0n
        ? { balanceKobo: Number(f.balanceKobo), ...(r.job.balanceDueAt ? { balanceDueDate: r.job.balanceDueAt.toISOString() } : {}) }
        : {}),
    };
  }
  return out;
}

/**
 * The customer says they've paid. Records the claim, alerts the provider, and asks for a recheck
 * with Kora. NEVER changes the request's status: only a verified payment does that.
 */
export async function claimPaid(deps: Deps, publicToken: string, client: { ip: string | null; userAgent: string | null }): Promise<{ ok: true }> {
  const r = await loadPublic(deps, publicToken);
  const now = deps.now();
  const state = STATE[effectiveStatus(r, now)];
  // Only a live or just-expired request can have money in flight. Anything else: neutral no-op.
  if (state !== 'waiting' && state !== 'expired') return { ok: true };

  const recent = await deps.db.claimEvent.count({ where: { requestId: r.id, createdAt: { gt: new Date(now.getTime() - CLAIM_WINDOW_MS) } } });
  if (recent >= CLAIMS_PER_WINDOW) throw new AppError('RATE_LIMITED', 'Thanks, the business already knows. Please wait a few minutes.');

  const hourBucket = Math.floor(now.getTime() / 3_600_000);
  const notificationId = await deps.db.$transaction(async (tx) => {
    await tx.claimEvent.create({
      data: {
        requestId: r.id,
        // Per-request salt: the same phone can't be linked across different requests.
        ipHash: client.ip ? (await sha256Hex(`${r.id}:${client.ip}`)).slice(0, 32) : null,
        userAgent: client.userAgent?.slice(0, 200) ?? null,
        createdAt: now,
      },
    });
    await tx.paymentRequest.updateMany({ where: { id: r.id, customerClaimedPaidAt: null }, data: { customerClaimedPaidAt: now } });
    const n = await createNotification(tx, {
      providerId: r.providerId,
      kind: 'CUSTOMER_CLAIMED_PAID',
      // At most one Telegram ping per request per hour, however often the button is tapped.
      dedupeKey: `CUSTOMER_CLAIMED_PAID:${r.id}:${hourBucket}`,
      payload: {
        text: customerClaimAlert({ customerName: r.job.customer.name, service: r.job.service, amountKobo: r.amountKobo }),
        buttons: [[{ text: 'Open job', url: `${deps.config.frontendUrl}/jobs/${r.jobId}` }]],
      },
    });
    return n.created ? n.id : null;
  });
  if (notificationId) await enqueueNotifications(deps, [notificationId]);
  try {
    await deps.queue.send({ type: 'request.recheck', requestId: r.id });
  } catch (err) {
    // Background reconciliation (BE-14) covers this request anyway.
    deps.log.warn('claim.recheck_enqueue_failed', { requestId: r.id, error: (err as Error).message });
  }
  deps.log.info('request.customer_claimed_paid', { requestId: r.id, providerId: r.providerId, koraReference: r.koraReference });
  return { ok: true };
}
