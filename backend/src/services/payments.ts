/**
 * The payment confirmation path (ARCHITECTURE.md §6.2).
 *
 * The Kora webhook is a trigger, never proof. A payment is recorded only after we query Kora for
 * the charge ourselves, and the amount recorded is Kora's *amount accepted*. Payment insert, request
 * status change, review flags and the provider alert are written in ONE transaction.
 */
import type { Deps } from '../deps';
import { computeJobFinancials } from '../domain/job';
import { languageOf, paidAlert, receiptMessage, type PreparedMessage } from '../domain/messages';
import { comparePayerName } from '../domain/names';
import { canTransition } from '../domain/request-state';
import { AppError, notFound } from '../errors';
import type { Prisma, ReviewKind } from '../generated/prisma/client';
import type { KoraCharge } from '../integrations/kora/types';
import type { Tx } from '../db/client';
import { createNotification, enqueueNotifications } from './notifications';
import { maskAccount, payLink, toPayment } from './serialize';
import type * as C from '../shared/contract';

export type VerifyOutcome =
  | { outcome: 'recorded'; paymentId: string; requestId: string }
  | { outcome: 'duplicate'; requestId: string }
  | { outcome: 'not_successful'; state: string }
  | { outcome: 'unmatched' };

/** Queue handler body for `kora.verify`. Throws on retryable failures (Kora down, DB error). */
export async function verifyReference(deps: Deps, reference: string, webhookEventId: string | null): Promise<VerifyOutcome> {
  const charge = await deps.kora.queryCharge(reference);
  if (!charge || charge.state !== 'success') {
    await markEventProcessed(deps, webhookEventId, `Kora status: ${charge?.rawStatus ?? 'not found'}`);
    deps.log.info('payment.not_successful', { koraReference: reference, koraStatus: charge?.rawStatus ?? null });
    return { outcome: 'not_successful', state: charge?.state ?? 'not_found' };
  }
  return recordVerifiedCharge(deps, charge, webhookEventId);
}

/** Record a charge that Kora has confirmed as successful. Idempotent per request. */
export async function recordVerifiedCharge(deps: Deps, charge: KoraCharge, webhookEventId: string | null): Promise<VerifyOutcome> {
  const started = Date.now();
  const req = await deps.db.paymentRequest.findUnique({ where: { koraReference: charge.reference }, select: { id: true, providerId: true } });
  if (!req) {
    await flagUnmatched(deps, charge, webhookEventId);
    return { outcome: 'unmatched' };
  }
  if (charge.amountAcceptedKobo == null || charge.amountAcceptedKobo <= 0n) {
    // Kora says success but gives no accepted amount; never guess. Retry, then dead-letter -> review.
    throw new Error(`Kora reported success for ${charge.reference} without an accepted amount`);
  }
  const accepted = charge.amountAcceptedKobo;
  const now = deps.now();

  const result = await deps.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PaymentRequest" WHERE id = ${req.id} FOR UPDATE`;
    const request = await tx.paymentRequest.findUniqueOrThrow({
      where: { id: req.id },
      include: {
        payment: { select: { id: true } },
        job: { include: { customer: true, payments: { select: { amountKobo: true, source: true } } } },
      },
    });
    if (request.payment) return { outcome: 'duplicate' as const, requestId: request.id, notificationIds: [] as string[] };
    if (!canTransition(request.status, 'PAID')) {
      // DRAFT/SCHEDULED never had an account, so Kora can't have been paid on it. Shouldn't happen.
      throw new Error(`Request ${request.id} in status ${request.status} can't be paid`);
    }

    const job = request.job;
    const before = computeJobFinancials({ ...job, payments: job.payments });
    const payment = await tx.payment.create({
      data: {
        providerId: request.providerId,
        jobId: job.id,
        requestId: request.id,
        source: 'KORA_VERIFIED',
        amountKobo: accepted,
        feeKobo: charge.feeKobo,
        payerName: charge.payerName,
        payerBank: charge.payerBank,
        payerAccountMasked: maskAccount(charge.payerAccountNumber),
        payerSimulated: charge.simulated,
        koraTransactionRef: charge.transactionReference,
        receivedAt: now,
      },
    });
    await tx.paymentRequest.update({ where: { id: request.id }, data: { status: 'PAID', paidAt: now } });
    const after = computeJobFinancials({ ...job, payments: [...job.payments, { amountKobo: accepted, source: 'KORA_VERIFIED' }] });

    const flags: string[] = [];
    const review = async (kind: ReviewKind, detail: Record<string, unknown>, message: string) => {
      flags.push(message);
      await tx.reviewItem.create({
        data: {
          providerId: request.providerId,
          kind,
          jobId: job.id,
          requestId: request.id,
          paymentId: payment.id,
          webhookEventId,
          detail: detail as Prisma.InputJsonValue,
        },
      });
    };
    if (accepted !== request.amountKobo) {
      await review('AMOUNT_MISMATCH', { acceptedKobo: accepted.toString(), expectedKobo: request.amountKobo.toString() }, 'Amount differs from the request. Check Needs review.');
    }
    if (request.status === 'EXPIRED' || request.status === 'CANCELLED') {
      await review(
        'PAID_AFTER_EXPIRY',
        { amountKobo: accepted.toString(), previousStatus: request.status },
        `Paid after the request was ${request.status === 'EXPIRED' ? 'expired' : 'cancelled'}. Check for an open replacement request.`,
      );
    }
    if (after.overpaid) {
      await review('JOB_OVERPAID', { overpaidByKobo: (-after.balanceKobo).toString() }, 'This job is now overpaid.');
    }
    if (!charge.simulated && comparePayerName(charge.payerName, job.customer.name) === 'different') {
      await review('PAYER_NAME_DIFFERS', { payerName: charge.payerName, customerName: job.customer.name }, 'Payer name looks different from the customer.');
    }

    const receipt = await buildReceipt(tx, deps, payment.id);
    const alert = await createNotification(tx, {
      providerId: request.providerId,
      kind: 'PAID_ALERT',
      dedupeKey: `PAID_ALERT:${payment.id}`,
      payload: {
        text: paidAlert({
          customerName: job.customer.name,
          service: job.service,
          kind: request.kind,
          amountKobo: accepted,
          balanceKobo: after.balanceKobo > 0n ? after.balanceKobo : 0n,
          balanceDueAt: job.balanceDueAt,
          readyToStart: after.readyToStart,
          becameReady: after.readyToStart && !before.readyToStart,
          payerName: charge.payerName,
          payerSimulated: charge.simulated,
          flags,
          now,
        }),
        buttons: [
          [{ text: 'Send receipt on WhatsApp', url: receipt.whatsappUrl }],
          [{ text: 'Open job', url: `${deps.config.frontendUrl}/jobs/${job.id}` }],
        ],
      },
    });
    if (webhookEventId) {
      await tx.webhookEvent.update({ where: { id: webhookEventId }, data: { processedAt: now, error: null } });
    }
    return { outcome: 'recorded' as const, paymentId: payment.id, requestId: request.id, notificationIds: alert.created ? [alert.id] : [] };
  });

  if (result.outcome === 'duplicate') {
    await markEventProcessed(deps, webhookEventId, null);
    deps.log.info('payment.duplicate', { koraReference: charge.reference, requestId: result.requestId });
    return { outcome: 'duplicate', requestId: result.requestId };
  }
  await enqueueNotifications(deps, result.notificationIds);
  deps.log.info('payment.recorded', {
    koraReference: charge.reference,
    requestId: result.requestId,
    paymentId: result.paymentId,
    providerId: req.providerId,
    amountKobo: accepted,
    latencyMs: Date.now() - started,
  });
  return { outcome: 'recorded', paymentId: result.paymentId, requestId: result.requestId };
}

async function flagUnmatched(deps: Deps, charge: KoraCharge, webhookEventId: string | null) {
  const existing = await deps.db.reviewItem.findFirst({
    where: { kind: 'UNMATCHED_REFERENCE', detail: { path: ['reference'], equals: charge.reference } },
    select: { id: true },
  });
  if (!existing) {
    await deps.db.reviewItem.create({
      data: {
        kind: 'UNMATCHED_REFERENCE',
        webhookEventId,
        detail: {
          reference: charge.reference,
          amountKobo: charge.amountAcceptedKobo?.toString() ?? null,
          payerName: charge.payerName,
        },
      },
    });
  }
  await markEventProcessed(deps, webhookEventId, 'Unmatched reference');
  deps.log.warn('payment.unmatched', { koraReference: charge.reference });
}

async function markEventProcessed(deps: Deps, webhookEventId: string | null, note: string | null) {
  if (!webhookEventId) return;
  await deps.db.webhookEvent.update({ where: { id: webhookEventId }, data: { processedAt: deps.now(), error: note } });
}

export async function buildReceipt(db: Tx | Deps['db'], deps: Deps, paymentId: string, providerId?: string): Promise<PreparedMessage> {
  const p = await db.payment.findUnique({
    where: { id: paymentId },
    include: {
      provider: { select: { businessName: true } },
      request: { select: { kind: true, publicToken: true } },
      job: { include: { customer: true, payments: { select: { amountKobo: true, source: true } } } },
    },
  });
  if (!p || (providerId && p.providerId !== providerId)) throw notFound('Payment');
  const f = computeJobFinancials({ ...p.job, payments: p.job.payments });
  return receiptMessage({
    businessName: p.provider.businessName,
    customerName: p.job.customer.name,
    customerPhone: p.job.customer.phoneE164,
    service: p.job.service,
    kind: p.request?.kind ?? null,
    amountKobo: p.amountKobo,
    balanceKobo: f.balanceKobo > 0n ? f.balanceKobo : 0n,
    balanceDueAt: p.job.balanceDueAt,
    paidAt: p.receivedAt,
    payLink: p.request ? payLink(deps.config, p.request.publicToken) : `${deps.config.publicBaseUrl}`,
    language: languageOf(p.job.customer.messageLanguage),
    now: deps.now(),
  });
}

/** Cash or off-app payment. Always labelled "not verified by Kora"; never counts towards Ready to start. */
export async function recordManualPayment(
  deps: Deps,
  providerId: string,
  jobId: string,
  input: { amountKobo: bigint; note?: string | null; receivedAt?: Date | null },
): Promise<C.Payment> {
  if (input.amountKobo <= 0n) throw new AppError('VALIDATION_ERROR', 'amountKobo must be greater than zero');
  return deps.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Job" WHERE id = ${jobId} AND "providerId" = ${providerId} FOR UPDATE`;
    const job = await tx.job.findFirst({
      where: { id: jobId, providerId },
      include: { payments: { select: { amountKobo: true, source: true } } },
    });
    if (!job) throw notFound('Job');
    const payment = await tx.payment.create({
      data: {
        providerId,
        jobId,
        source: 'MANUAL',
        amountKobo: input.amountKobo,
        note: input.note ?? null,
        receivedAt: input.receivedAt ?? deps.now(),
      },
    });
    const after = computeJobFinancials({ ...job, payments: [...job.payments, { amountKobo: input.amountKobo, source: 'MANUAL' }] });
    if (after.overpaid) {
      await tx.reviewItem.create({
        data: { providerId, kind: 'JOB_OVERPAID', jobId, paymentId: payment.id, detail: { overpaidByKobo: (-after.balanceKobo).toString() } },
      });
    }
    return toPayment(payment);
  });
}
