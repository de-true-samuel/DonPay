/** Database rows -> contract DTOs (src/shared/contract.ts). The only place that shapes API output. */
import type { AppConfig } from '../config';
import { computeJobFinancials } from '../domain/job';
import { formatNaira } from '../domain/money';
import { formatHHMM } from '../domain/time';
import type { Prisma } from '../generated/prisma/client';
import type * as C from '../shared/contract';

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export const jobInclude = {
  customer: { select: { id: true, name: true, phoneE164: true } },
  payments: { select: { amountKobo: true, source: true } },
  requests: { where: { status: { in: ['SCHEDULED', 'SENT'] } }, orderBy: { createdAt: 'desc' }, take: 1 },
} as const satisfies Prisma.JobInclude;

export type JobWithSummary = Prisma.JobGetPayload<{ include: typeof jobInclude }>;
type RequestRow = Prisma.PaymentRequestGetPayload<object>;
type PaymentRow = Prisma.PaymentGetPayload<object>;
type ReviewRow = Prisma.ReviewItemGetPayload<object>;
type ProviderRow = Prisma.ProviderGetPayload<object>;
type CustomerRow = Prisma.CustomerGetPayload<object>;

export function payLink(config: AppConfig, publicToken: string): string {
  return `${config.publicBaseUrl}/p/${publicToken}`;
}

export function toProvider(p: ProviderRow): C.Provider {
  return {
    id: p.id,
    businessName: p.businessName,
    telegramLinked: p.telegramChatId != null,
    defaultReadyRule: p.defaultReadyRule,
    digestTime: p.digestMinuteOfDay == null ? null : formatHHMM(p.digestMinuteOfDay),
    phone: p.phoneE164,
    onboardedAt: isoOrNull(p.onboardedAt),
    createdAt: iso(p.createdAt),
  };
}

export function toCustomer(c: CustomerRow): C.Customer {
  // messageConsent is deprecated (BE-15): never read from the row, always reported as false.
  return { id: c.id, name: c.name, phone: c.phoneE164, messageConsent: false, messageLanguage: c.messageLanguage, createdAt: iso(c.createdAt) };
}

export function toRequest(config: AppConfig, r: RequestRow): C.PaymentRequest {
  return {
    id: r.id,
    jobId: r.jobId,
    kind: r.kind,
    amountKobo: r.amountKobo.toString(),
    status: r.status,
    payLink: payLink(config, r.publicToken),
    bankName: r.bankName,
    accountNumber: r.accountNumber,
    accountName: r.accountName,
    expiresAt: isoOrNull(r.expiresAt),
    scheduledFor: isoOrNull(r.scheduledFor),
    sentAt: isoOrNull(r.sentAt),
    paidAt: isoOrNull(r.paidAt),
    detailsCopiedAt: isoOrNull(r.detailsCopiedAt),
    customerClaimedPaidAt: isoOrNull(r.customerClaimedPaidAt),
    createdAt: iso(r.createdAt),
  };
}

export function toPayment(p: PaymentRow): C.Payment {
  return {
    id: p.id,
    jobId: p.jobId,
    requestId: p.requestId,
    source: p.source,
    amountKobo: p.amountKobo.toString(),
    payerName: p.payerName,
    payerBank: p.payerBank,
    payerAccountMasked: p.payerAccountMasked,
    payerDetailsSimulated: p.payerSimulated,
    note: p.note,
    receivedAt: iso(p.receivedAt),
    createdAt: iso(p.createdAt),
  };
}

export function financialsOf(job: Pick<JobWithSummary, 'totalKobo' | 'plan' | 'depositKobo' | 'readyRule' | 'cancelledAt' | 'payments'>) {
  return computeJobFinancials({
    totalKobo: job.totalKobo,
    plan: job.plan,
    depositKobo: job.depositKobo,
    readyRule: job.readyRule,
    cancelledAt: job.cancelledAt,
    payments: job.payments,
  });
}

export function toJobSummary(config: AppConfig, job: JobWithSummary): C.JobSummary {
  const f = financialsOf(job);
  const open = job.requests[0];
  return {
    id: job.id,
    customer: { id: job.customer.id, name: job.customer.name, phone: job.customer.phoneE164 },
    service: job.service,
    totalKobo: job.totalKobo.toString(),
    plan: job.plan,
    depositKobo: job.depositKobo?.toString() ?? null,
    balanceDueAt: isoOrNull(job.balanceDueAt),
    readyRule: job.readyRule,
    notes: job.notes,
    status: f.status,
    paidKobo: f.paidKobo.toString(),
    verifiedPaidKobo: f.verifiedPaidKobo.toString(),
    balanceKobo: f.balanceKobo.toString(),
    readyToStart: f.readyToStart,
    hasUnverifiedPayments: f.hasUnverifiedPayments,
    openRequest: open ? toRequest(config, open) : null,
    createdAt: iso(job.createdAt),
    cancelledAt: isoOrNull(job.cancelledAt),
  };
}

const kobo = (v: unknown) => (typeof v === 'string' && /^-?\d+$/.test(v) ? formatNaira(BigInt(v)) : '?');

export function reviewMessage(kind: C.ReviewKind, detail: Record<string, unknown>): string {
  switch (kind) {
    case 'UNMATCHED_REFERENCE':
      return `A payment arrived (reference ${detail.reference ?? 'unknown'}) that doesn't match any request.`;
    case 'PAID_AFTER_EXPIRY':
      return `A payment of ${kobo(detail.amountKobo)} arrived after the request had ${detail.previousStatus === 'CANCELLED' ? 'been cancelled' : 'expired'}. It has been recorded. Check whether a replacement request is still open.`;
    case 'JOB_OVERPAID':
      return `This job has received ${kobo(detail.overpaidByKobo)} more than its total.`;
    case 'AMOUNT_MISMATCH':
      return `Kora accepted ${kobo(detail.acceptedKobo)} but the request was for ${kobo(detail.expectedKobo)}.`;
    case 'PAYER_NAME_DIFFERS':
      return `The payer name "${detail.payerName ?? 'unknown'}" looks different from the customer "${detail.customerName ?? ''}".`;
    case 'VERIFICATION_FAILED':
      return `We couldn't verify a payment notification for reference ${detail.reference ?? 'unknown'} after several tries.`;
  }
}

export function toReviewItem(r: ReviewRow): C.ReviewItem {
  const detail = (r.detail ?? {}) as Record<string, unknown>;
  return {
    id: r.id,
    kind: r.kind,
    message: reviewMessage(r.kind, detail),
    jobId: r.jobId,
    requestId: r.requestId,
    paymentId: r.paymentId,
    detail,
    createdAt: iso(r.createdAt),
    resolvedAt: isoOrNull(r.resolvedAt),
    resolution: r.resolution,
  };
}

/** "******4321" */
export function maskAccount(acct: string | null): string | null {
  if (!acct) return null;
  const last = acct.slice(-4);
  return `${'*'.repeat(Math.max(0, acct.length - 4))}${last}`;
}
