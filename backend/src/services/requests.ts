/**
 * Payment requests: send ("Get payment details": allocate a Kora account at that moment), schedule
 * (a reminder only), cancel, resend, exact balance requests, plus the 1.1.0 additions: copied
 * marker, recheck with Kora and the nudge message. See ARCHITECTURE.md §6.1, §6.4–6.6.
 */
import { isUniqueViolation } from '../db/client';
import type { Deps } from '../deps';
import { computeJobFinancials } from '../domain/job';
import { languageOf, nudgeMessage, paymentRequestMessage, type PreparedMessage, type RequestMessageInput } from '../domain/messages';
import { isActionAllowed } from '../domain/request-state';
import { koraReferenceFor, nextAttemptReference, randomToken } from '../domain/tokens';
import { AppError, invalidState, notFound, validation } from '../errors';
import { KoraDuplicateReferenceError, KoraError } from '../integrations/kora/types';
import { payLink, toRequest } from './serialize';
import { reconcileRequest } from './reconcile';
import { assertJobOpen, getJobSummary } from './jobs';
import { buildReceipt } from './payments';
import type * as C from '../shared/contract';

const requestContext = {
  provider: { select: { businessName: true } },
  job: { include: { customer: true, payments: { select: { amountKobo: true, source: true } } } },
} as const;

async function loadRequest(deps: Deps, providerId: string, requestId: string) {
  const r = await deps.db.paymentRequest.findFirst({ where: { id: requestId, providerId }, include: requestContext });
  if (!r) throw notFound('Payment request');
  return r;
}
type LoadedRequest = Awaited<ReturnType<typeof loadRequest>>;

function messageInput(deps: Deps, r: LoadedRequest): RequestMessageInput {
  if (!r.bankName || !r.accountNumber || !r.accountName || !r.expiresAt) throw invalidState('This request has no bank account yet. Get payment details first.');
  return {
    businessName: r.provider.businessName,
    customerPhone: r.job.customer.phoneE164,
    service: r.job.service,
    kind: r.kind,
    amountKobo: r.amountKobo,
    bankName: r.bankName,
    accountNumber: r.accountNumber,
    accountName: r.accountName,
    expiresAt: r.expiresAt,
    payLink: payLink(deps.config, r.publicToken),
    language: languageOf(r.job.customer.messageLanguage),
    now: deps.now(),
  };
}

function messageFor(deps: Deps, r: LoadedRequest): PreparedMessage {
  return paymentRequestMessage(messageInput(deps, r));
}

async function withMessage(deps: Deps, providerId: string, requestId: string, includeMessage: boolean): Promise<C.RequestWithMessage> {
  const r = await loadRequest(deps, providerId, requestId);
  return {
    request: toRequest(deps.config, r),
    job: await getJobSummary(deps, providerId, r.jobId),
    message: includeMessage ? messageFor(deps, r) : null,
  };
}

async function assertNoOtherOpenRequest(deps: Deps, jobId: string, exceptId: string | null, includeDrafts = false) {
  const other = await deps.db.paymentRequest.findFirst({
    where: {
      jobId,
      status: { in: includeDrafts ? ['DRAFT', 'SCHEDULED', 'SENT'] : ['SCHEDULED', 'SENT'] },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true, status: true },
  });
  if (other) {
    throw new AppError(
      'OPEN_REQUEST_EXISTS',
      other.status === 'DRAFT' ? 'This job already has an unsent request. Send or cancel it first.' : 'This job already has an open payment request.',
      { requestId: other.id },
    );
  }
}

/**
 * Allocate a single-use Kora account and mark the request SENT. Safe to retry:
 * a request that is already SENT returns the same account and message.
 */
export async function sendRequest(deps: Deps, providerId: string, requestId: string): Promise<C.RequestWithMessage> {
  let r = await loadRequest(deps, providerId, requestId);
  if (r.status === 'SENT') return withMessage(deps, providerId, requestId, true);
  if (!isActionAllowed('send', r.status)) throw invalidState(`A ${r.status.toLowerCase()} request can't be sent`);
  assertJobOpen(r.job);
  await assertNoOtherOpenRequest(deps, r.jobId, r.id);

  // 1. Persist our reference BEFORE calling Kora, so a retry reuses it.
  let reference = r.koraReference ?? koraReferenceFor(r.id);
  if (!r.koraReference) {
    await deps.db.paymentRequest.updateMany({ where: { id: r.id, koraReference: null }, data: { koraReference: reference } });
    r = await loadRequest(deps, providerId, requestId);
    reference = r.koraReference!;
  }

  // 2. Allocate the account.
  const allocate = (ref: string) =>
    deps.kora.createSingleUseAccount({
      reference: ref,
      amountKobo: r.amountKobo,
      customerName: r.job.customer.name,
      customerEmail: `${r.id}@${deps.config.placeholderEmailDomain}`,
      accountName: r.provider.businessName,
      narration: `${r.job.service} (${r.kind.toLowerCase()})`.slice(0, 100),
      notificationUrl: `${deps.config.publicBaseUrl}/webhooks/kora`,
    });
  let account;
  try {
    try {
      account = await allocate(reference);
    } catch (err) {
      if (!(err instanceof KoraDuplicateReferenceError)) throw err;
      // An earlier attempt reached Kora but we never saved the account. That account was never
      // shown to anyone, so allocate a fresh one under the next reference.
      reference = nextAttemptReference(reference);
      await deps.db.paymentRequest.update({ where: { id: r.id }, data: { koraReference: reference } });
      account = await allocate(reference);
    }
  } catch (err) {
    deps.log.error('request.kora_allocate_failed', { requestId: r.id, koraReference: reference, error: (err as Error).message });
    if (err instanceof KoraError) throw new AppError('KORA_UNAVAILABLE', "Couldn't create the payment account with Kora. Please try again.");
    throw err;
  }

  // 3. Mark SENT. The partial unique index rejects a second open request on the same job.
  const now = deps.now();
  try {
    const { count } = await deps.db.paymentRequest.updateMany({
      where: { id: r.id, status: { in: ['DRAFT', 'SCHEDULED'] } },
      data: {
        status: 'SENT',
        bankName: account.bankName,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
        expiresAt: account.expiresAt,
        sentAt: now,
      },
    });
    if (count === 0) {
      // A concurrent send won the race; return whatever it stored.
      const current = await loadRequest(deps, providerId, requestId);
      if (current.status !== 'SENT') throw invalidState(`A ${current.status.toLowerCase()} request can't be sent`);
    }
  } catch (err) {
    if (isUniqueViolation(err, 'one_open_request_per_job')) {
      throw new AppError('OPEN_REQUEST_EXISTS', 'This job already has an open payment request.');
    }
    if (isUniqueViolation(err, 'one_live_request_per_account')) {
      // Kora handed out an account number that another live request already uses. Never show it.
      // The request stays a draft; a retry gets a fresh account under the next reference.
      deps.log.error('request.duplicate_account_number', { requestId: r.id, koraReference: reference, bankName: account.bankName });
      throw new AppError('KORA_UNAVAILABLE', "Couldn't create a unique payment account. Please try again.");
    }
    throw err;
  }
  deps.log.info('request.sent', { requestId: r.id, koraReference: reference, jobId: r.jobId, providerId, amountKobo: r.amountKobo });
  return withMessage(deps, providerId, requestId, true);
}

export async function scheduleRequest(deps: Deps, providerId: string, requestId: string, scheduledFor: Date): Promise<C.RequestWithMessage> {
  const r = await loadRequest(deps, providerId, requestId);
  if (!isActionAllowed('schedule', r.status)) throw invalidState(`A ${r.status.toLowerCase()} request can't be scheduled`);
  assertJobOpen(r.job);
  if (scheduledFor.getTime() <= deps.now().getTime()) throw validation('scheduledFor must be in the future', 'scheduledFor');
  await assertNoOtherOpenRequest(deps, r.jobId, r.id);
  try {
    await deps.db.paymentRequest.update({ where: { id: r.id }, data: { status: 'SCHEDULED', scheduledFor, promptedAt: null } });
  } catch (err) {
    if (isUniqueViolation(err, 'one_open_request_per_job')) throw new AppError('OPEN_REQUEST_EXISTS', 'This job already has an open payment request.');
    throw err;
  }
  return withMessage(deps, providerId, requestId, false);
}

export async function cancelRequest(deps: Deps, providerId: string, requestId: string): Promise<C.RequestWithMessage> {
  const r = await loadRequest(deps, providerId, requestId);
  if (r.status === 'CANCELLED') return withMessage(deps, providerId, requestId, false);
  if (!isActionAllowed('cancel', r.status)) throw invalidState(`A ${r.status.toLowerCase()} request can't be cancelled`);
  const { count } = await deps.db.paymentRequest.updateMany({
    where: { id: r.id, status: { in: ['DRAFT', 'SCHEDULED', 'SENT'] } },
    data: { status: 'CANCELLED', cancelledAt: deps.now() },
  });
  if (count === 0) throw invalidState('This request changed while cancelling. Refresh and try again.');
  deps.log.info('request.cancelled', { requestId: r.id, providerId });
  return withMessage(deps, providerId, requestId, false);
}

/**
 * SENT and still valid → the same message again (re-share).
 * EXPIRED (or SENT past its expiry) → a NEW request with a new account. Old accounts are never reused.
 */
export async function resendRequest(deps: Deps, providerId: string, requestId: string): Promise<C.RequestWithMessage> {
  const r = await loadRequest(deps, providerId, requestId);
  if (!isActionAllowed('resend', r.status)) throw invalidState(`A ${r.status.toLowerCase()} request can't be resent`);
  const now = deps.now();
  if (r.status === 'SENT' && r.expiresAt && r.expiresAt.getTime() > now.getTime()) {
    return withMessage(deps, providerId, requestId, true);
  }
  assertJobOpen(r.job);
  if (r.status === 'SENT') {
    await deps.db.paymentRequest.updateMany({ where: { id: r.id, status: 'SENT' }, data: { status: 'EXPIRED', expiredAt: now } });
  }
  const f = computeJobFinancials({ ...r.job, payments: r.job.payments });
  if (f.balanceKobo <= 0n) throw new AppError('NOTHING_OWED', 'This job is already fully paid.');
  const amount = r.kind === 'BALANCE' ? f.balanceKobo : r.amountKobo < f.balanceKobo ? r.amountKobo : f.balanceKobo;
  await assertNoOtherOpenRequest(deps, r.jobId, null);
  const replacement = await deps.db.paymentRequest.create({
    data: { providerId, jobId: r.jobId, kind: r.kind, amountKobo: amount, publicToken: randomToken(16), replacesId: r.id },
  });
  deps.log.info('request.replaced', { oldRequestId: r.id, requestId: replacement.id, providerId });
  return sendRequest(deps, providerId, replacement.id);
}

/** Exact balance request: amount = total − paid, computed here, never sent by the client. */
export async function createBalanceRequest(deps: Deps, providerId: string, jobId: string, opts: { send: boolean }): Promise<C.RequestWithMessage> {
  const created = await deps.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Job" WHERE id = ${jobId} AND "providerId" = ${providerId} FOR UPDATE`;
    const job = await tx.job.findFirst({
      where: { id: jobId, providerId },
      include: { payments: { select: { amountKobo: true, source: true } } },
    });
    if (!job) throw notFound('Job');
    assertJobOpen(job);
    const open = await tx.paymentRequest.findFirst({
      where: { jobId, status: { in: ['DRAFT', 'SCHEDULED', 'SENT'] } },
      select: { id: true, status: true },
    });
    if (open) {
      throw new AppError(
        'OPEN_REQUEST_EXISTS',
        open.status === 'DRAFT' ? 'This job already has an unsent request. Send or cancel it first.' : 'This job already has an open payment request.',
        { requestId: open.id },
      );
    }
    const f = computeJobFinancials({ ...job, payments: job.payments });
    if (f.balanceKobo <= 0n) throw new AppError('NOTHING_OWED', 'This job is already fully paid.');
    return tx.paymentRequest.create({
      data: { providerId, jobId, kind: 'BALANCE', amountKobo: f.balanceKobo, publicToken: randomToken(16) },
    });
  });
  deps.log.info('request.balance_created', { requestId: created.id, jobId, providerId, amountKobo: created.amountKobo });
  if (opts.send) return sendRequest(deps, providerId, created.id);
  return withMessage(deps, providerId, created.id, false);
}

export async function getRequestMessage(deps: Deps, providerId: string, requestId: string): Promise<PreparedMessage> {
  const r = await loadRequest(deps, providerId, requestId);
  if (r.status !== 'SENT' && r.status !== 'PAID') throw invalidState(`A ${r.status.toLowerCase()} request has no message to share`);
  return messageFor(deps, r);
}

export async function getReceiptMessage(deps: Deps, providerId: string, paymentId: string): Promise<PreparedMessage> {
  return buildReceipt(deps.db, deps, paymentId, providerId);
}

/** BE-05: the provider copied the details. Set once; later calls return the existing value. */
export async function markDetailsCopied(deps: Deps, providerId: string, requestId: string): Promise<C.PaymentRequest> {
  const r = await deps.db.paymentRequest.findFirst({ where: { id: requestId, providerId }, select: { id: true, accountNumber: true } });
  if (!r) throw notFound('Payment request');
  if (!r.accountNumber) throw invalidState('This request has no payment details yet.');
  await deps.db.paymentRequest.updateMany({ where: { id: r.id, detailsCopiedAt: null }, data: { detailsCopiedAt: deps.now() } });
  return toRequest(deps.config, await deps.db.paymentRequest.findUniqueOrThrow({ where: { id: r.id } }));
}

/**
 * BE-06: ask Kora about this request now and record any payment it confirms. Same code path as
 * webhooks and background reconciliation, so it can never double-credit. Safe to call repeatedly.
 */
export async function recheckRequest(deps: Deps, providerId: string, requestId: string): Promise<C.RequestWithMessage> {
  const r = await loadRequest(deps, providerId, requestId);
  try {
    const outcome = await reconcileRequest(deps, r.id);
    deps.log.info('request.recheck', { requestId: r.id, koraReference: r.koraReference, providerId, outcome });
  } catch (err) {
    deps.log.warn('request.recheck_failed', { requestId: r.id, koraReference: r.koraReference, error: (err as Error).message });
    if (err instanceof KoraError) throw new AppError('KORA_UNAVAILABLE', "Couldn't reach Kora to check this payment. Please try again.");
    throw err;
  }
  const after = await loadRequest(deps, providerId, requestId);
  return withMessage(deps, providerId, requestId, after.status === 'SENT');
}

/** BE-07: a reminder the provider can copy while the account still has time left. Read-only. */
export async function getNudgeMessage(deps: Deps, providerId: string, requestId: string): Promise<PreparedMessage> {
  const r = await loadRequest(deps, providerId, requestId);
  const now = deps.now();
  const expired = r.status === 'EXPIRED' || (r.status === 'SENT' && r.expiresAt != null && r.expiresAt.getTime() <= now.getTime());
  if (expired) throw new AppError('REQUEST_EXPIRED', 'These payment details have expired. Get new details instead.');
  if (r.status !== 'SENT') throw new AppError('REQUEST_NOT_WAITING', `A ${r.status.toLowerCase()} request isn't waiting for payment.`);
  return nudgeMessage(messageInput(deps, r));
}
