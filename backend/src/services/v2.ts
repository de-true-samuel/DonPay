/**
 * Paidar v2.0.0 Service Layer
 * Implements Queue/Capacity, Work-Status transitions + Audit Log, Ephemeral ChargeAttempts,
 * Public Receipts, Waitlist, Notifications Read State, and Sample Data cleanup.
 */
import type { Deps } from '../deps';
import { AppError } from '../errors';
import { computeQueue, DEFAULT_WORKING_HOURS, type QueueInputJob, type WorkingHours } from '../domain/queue';
import { koraReferenceFor } from '../domain/tokens';
import type { JobWorkStatus } from '../generated/prisma/enums';

export async function joinWaitlist(
  d: Deps,
  input: { email: string; whatsappPhone?: string; businessType?: string },
): Promise<{ ok: true }> {
  const email = input.email.trim().toLowerCase();
  await d.db.waitlistEntry.upsert({
    where: { email },
    update: {}, // Never reveal existing membership; keep original entry
    create: {
      email,
      whatsappPhone: input.whatsappPhone?.trim() || null,
      businessType: input.businessType?.trim() || null,
    },
  });
  return { ok: true };
}

function parseWorkingHours(raw: unknown): WorkingHours {
  if (!raw || typeof raw !== 'object') return DEFAULT_WORKING_HOURS;
  return raw as WorkingHours;
}

function mapWorkStatus(ws: JobWorkStatus): QueueInputJob['workStatus'] {
  switch (ws) {
    case 'AWAITING_PAYMENT': return 'awaiting_payment';
    case 'READY': return 'ready';
    case 'IN_PROGRESS': return 'in_progress';
    case 'COMPLETED': return 'completed';
    case 'ON_HOLD': return 'on_hold';
    case 'CANCELLED': return 'cancelled';
  }
}

export async function getQueueV2(d: Deps, providerId: string) {
  const provider = await d.db.provider.findUniqueOrThrow({ where: { id: providerId } });
  const wh = parseWorkingHours(provider.workingHoursJson);
  const now = d.now();

  const jobs = await d.db.job.findMany({
    where: { providerId, cancelledAt: null },
    include: {
      customer: true,
      payments: true,
      activityEvents: {
        where: { eventType: 'SCHEDULE_APPROVED' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const approvalByJob = new Map<string, string>();
  const mapped = jobs.map((j) => {
    if (j.activityEvents[0]) {
      approvalByJob.set(j.id, j.activityEvents[0].detail ?? 'Approved');
    }
    const verifiedPaidKobo = j.payments
      .filter((p) => p.source === 'KORA_VERIFIED')
      .reduce((s, p) => s + p.amountKobo, 0n);
    const depositPaid = j.paymentTerms === 'DEPOSIT' && verifiedPaidKobo > 0n && verifiedPaidKobo < j.totalKobo;

    return {
      id: j.id,
      title: j.title ?? j.service.slice(0, 60),
      description: j.service,
      client: {
        id: j.customer.id,
        name: j.customer.name,
        phoneE164: j.customer.phoneE164 || null,
        email: j.customer.email ?? null,
      },
      workStatus: mapWorkStatus(j.workStatus),
      paymentTerms: j.paymentTerms,
      depositPercent: j.depositPercent ?? null,
      feeBearer: j.feeBearer,
      totalKobo: j.totalKobo.toString(),
      verifiedPaidKobo: verifiedPaidKobo.toString(),
      balanceKobo: (j.totalKobo - verifiedPaidKobo).toString(),
      dueDate: j.balanceDueAt,
      estimatedHours: j.estimatedHours ?? null,
      startedWithoutPayment: j.startedWithoutPayment,
      depositPaid,
      isSample: j.isSample,
      createdAt: j.createdAt.toISOString(),
    };
  });

  const computed = computeQueue(mapped, wh, now);
  const serializeItem = (item: (typeof computed.ready)[number]) => ({
    ...item.job,
    dueDate: item.job.dueDate ? item.job.dueDate.toISOString() : null,
    isOverdue: item.isOverdue,
    isAtRisk: item.isAtRisk,
    rank: item.rank,
    priorityScore: item.priorityScore,
    priorityBreakdown: item.priorityBreakdown,
    recommendedSlot: item.recommendedSlot,
    scheduleApproved: approvalByJob.has(item.job.id),
    approvedSlotLabel: approvalByJob.get(item.job.id) ?? null,
    reasonLabel: item.reasonLabel,
  });

  return {
    capacity: computed.capacity,
    inProgress: computed.inProgress.map(serializeItem),
    ready: computed.ready.map(serializeItem),
    waitingForPayment: computed.waitingForPayment.map(serializeItem),
  };
}

export async function approveJobSchedule(d: Deps, providerId: string, jobId: string, slotLabel: string) {
  const job = await d.db.job.findFirst({ where: { id: jobId, providerId } });
  if (!job) throw new AppError('NOT_FOUND', 'Job not found');
  const clean = slotLabel.trim().slice(0, 120) || 'Approved schedule window';
  await d.db.activityEvent.create({
    data: {
      providerId,
      jobId: job.id,
      actor: 'OWNER',
      category: 'STATUS',
      eventType: 'SCHEDULE_APPROVED',
      summary: `Approved schedule: ${clean}`,
      detail: clean,
    },
  });
  return { id: job.id, scheduleApproved: true, approvedSlotLabel: clean };
}

export async function transitionJobWorkStatus(
  d: Deps,
  providerId: string,
  jobId: string,
  action: 'start' | 'complete' | 'hold' | 'resume' | 'override_ready',
  reason?: string,
) {
  const job = await d.db.job.findFirst({ where: { id: jobId, providerId } });
  if (!job) throw new AppError('NOT_FOUND', 'Job not found');

  let nextStatus: JobWorkStatus;
  let startedWithoutPayment = job.startedWithoutPayment;
  let overrideReason = job.overrideReason;
  let summary: string;

  switch (action) {
    case 'override_ready': {
      if (job.workStatus !== 'AWAITING_PAYMENT') {
        throw new AppError('INVALID_STATE', 'Only jobs awaiting payment can be marked ready anyway.');
      }
      const clean = reason?.trim() ?? '';
      if (clean.length < 5 || clean.length > 200) {
        throw new AppError('VALIDATION_ERROR', 'Provide a reason between 5 and 200 characters.');
      }
      nextStatus = 'READY';
      startedWithoutPayment = true;
      overrideReason = clean;
      summary = `Marked ready without payment: ${clean}`;
      break;
    }
    case 'start': {
      if (job.workStatus !== 'READY') {
        throw new AppError('INVALID_STATE', 'Job must be Ready before starting.');
      }
      nextStatus = 'IN_PROGRESS';
      summary = 'Started job';
      break;
    }
    case 'complete': {
      if (job.workStatus !== 'IN_PROGRESS' && job.workStatus !== 'READY') {
        throw new AppError('INVALID_STATE', 'Only active jobs can be marked completed.');
      }
      nextStatus = 'COMPLETED';
      summary = 'Marked job completed';
      break;
    }
    case 'hold': {
      if (job.workStatus !== 'READY' && job.workStatus !== 'IN_PROGRESS') {
        throw new AppError('INVALID_STATE', 'Only ready or in-progress jobs can be put on hold.');
      }
      nextStatus = 'ON_HOLD';
      summary = reason?.trim() ? `Put on hold: ${reason.trim()}` : 'Put job on hold';
      break;
    }
    case 'resume': {
      if (job.workStatus !== 'ON_HOLD') {
        throw new AppError('INVALID_STATE', 'Only held jobs can be resumed.');
      }
      nextStatus = 'READY';
      summary = 'Resumed job';
      break;
    }
  }

  return d.db.$transaction(async (tx) => {
    const updated = await tx.job.update({
      where: { id: job.id },
      data: { workStatus: nextStatus, startedWithoutPayment, overrideReason },
    });
    await tx.activityEvent.create({
      data: {
        providerId,
        jobId: job.id,
        actor: 'OWNER',
        category: 'STATUS',
        eventType: `JOB_${action.toUpperCase()}`,
        summary,
        detail: reason?.trim() || null,
      },
    });
    return { id: updated.id, workStatus: mapWorkStatus(updated.workStatus), startedWithoutPayment };
  });
}

export async function createOrGetActiveAttempt(d: Deps, publicToken: string) {
  const req = await d.db.paymentRequest.findUnique({
    where: { publicToken },
    include: { provider: true, job: { include: { customer: true } }, attempts: { orderBy: { createdAt: 'desc' } } },
  });
  if (!req) throw new AppError('NOT_FOUND', 'Payment request not found');
  if (req.status === 'PAID' || req.status === 'CANCELLED' || req.status === 'REFUNDED' || req.status === 'NOT_REQUESTED') {
    throw new AppError('INVALID_STATE', 'This payment request is not accepting new payment attempts.');
  }

  const now = d.now();
  const active = req.attempts.find((a) => a.status === 'ACCOUNT_ACTIVE');
  if (active && active.expiresAt.getTime() > now.getTime()) {
    return {
      id: active.id,
      status: 'account_active' as const,
      bankName: active.bankName,
      accountName: active.accountName,
      accountNumber: active.accountNumber,
      expiresAt: active.expiresAt.toISOString(),
    };
  }

  // Expire any stale active attempts, then allocate a fresh dynamic account from Kora
  const koraRef = koraReferenceFor(req.id, req.attempts.length + 1);
  const allocated = await d.kora.createSingleUseAccount({
    reference: koraRef,
    amountKobo: req.amountKobo,
    customerName: req.job.customer.name,
    customerEmail: req.job.customer.email ?? `${req.providerId}@${d.config.placeholderEmailDomain}`,
    accountName: req.provider.businessName,
    narration: req.job.service.slice(0, 60),
    notificationUrl: `${d.config.publicBaseUrl}/webhooks/kora`,
  });

  const created = await d.db.$transaction(async (tx) => {
    if (active) {
      await tx.chargeAttempt.update({
        where: { id: active.id },
        data: { status: 'EXPIRED' },
      });
    }
    const attempt = await tx.chargeAttempt.create({
      data: {
        requestId: req.id,
        koraReference: allocated.reference,
        bankName: allocated.bankName,
        accountNumber: allocated.accountNumber,
        accountName: allocated.accountName,
        status: 'ACCOUNT_ACTIVE',
        expiresAt: allocated.expiresAt,
      },
    });
    await tx.activityEvent.create({
      data: {
        providerId: req.providerId,
        jobId: req.jobId,
        requestId: req.id,
        actor: 'CLIENT',
        category: 'PAYMENTS',
        eventType: 'ATTEMPT_CREATED',
        summary: 'Temporary payment account generated',
        detail: `${allocated.bankName} · ${allocated.reference}`,
      },
    });
    return attempt;
  });

  return {
    id: created.id,
    status: 'account_active' as const,
    bankName: created.bankName,
    accountName: created.accountName,
    accountNumber: created.accountNumber,
    expiresAt: created.expiresAt.toISOString(),
  };
}

export async function getPublicReceiptV2(d: Deps, publicToken: string) {
  const req = await d.db.paymentRequest.findUnique({
    where: { publicToken },
    include: { provider: true, job: { include: { customer: true } }, payment: true },
  });
  if (!req || !req.payment || (req.status !== 'PAID' && req.status !== 'REFUNDED')) {
    throw new AppError('NOT_FOUND', 'Verified receipt not found');
  }

  return {
    businessName: req.provider.businessName,
    businessPhone: req.provider.showPhoneOnPayPage ? req.provider.phoneE164 : null,
    status: req.status === 'REFUNDED' ? ('refunded' as const) : ('paid' as const),
    jobTitle: req.job.title ?? req.job.service.slice(0, 60),
    jobDescription: req.job.service,
    clientName: req.job.customer.name,
    payerName: req.payment.payerName,
    payerBank: req.payment.payerBank,
    acceptedAmountKobo: req.payment.amountKobo.toString(),
    feeKobo: req.payment.feeKobo?.toString() ?? null,
    netKobo: req.payment.feeKobo !== null ? (req.payment.amountKobo - req.payment.feeKobo).toString() : null,
    koraReference: req.payment.koraTransactionRef ?? req.koraReference ?? req.id,
    requestReference: req.id,
    paidAt: req.payment.receivedAt.toISOString(),
    isTestMode: d.config.koraMode !== 'live',
  };
}

export async function markNotificationRead(d: Deps, providerId: string, notificationId: string) {
  const n = await d.db.notification.findFirst({ where: { id: notificationId, providerId } });
  if (!n) throw new AppError('NOT_FOUND', 'Notification not found');
  await d.db.notification.update({
    where: { id: n.id },
    data: { readAt: d.now() },
  });
  return { ok: true };
}

export async function markAllNotificationsRead(d: Deps, providerId: string) {
  await d.db.notification.updateMany({
    where: { providerId, readAt: null },
    data: { readAt: d.now() },
  });
  return { ok: true };
}

export async function removeSampleData(d: Deps, providerId: string) {
  const result = await d.db.job.deleteMany({
    where: { providerId, isSample: true },
  });
  return { deletedJobs: result.count };
}
