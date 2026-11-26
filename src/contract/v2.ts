/**
 * Paidar v2.0.0 Target Contract Schemas
 * Aligns with:
 * - Paidar_Master_UI_UX_Design_Specification_v2.md
 * - paidar-user-interaction-flow.md
 * - paidar-product-scope-and-execution-blueprint.md
 *
 * All monetary amounts are whole kobo as decimal strings (never floats).
 */
import { z } from 'zod';

export const CONTRACT_V2_VERSION = '2.0.0';

export const KoboString = z.string().regex(/^-?\d+$/);
export type KoboString = z.infer<typeof KoboString>;

const id = z.string();
const iso = z.string();

/* ---------- 1. Canonical State Machines ---------- */

/** Durable payment request status (interaction-flow §3.1) */
export const PaymentRequestStatusV2 = z.enum([
  'not_requested',
  'awaiting_payment',
  'paid',
  'under_review',
  'cancelled',
  'refunded',
]);
export type PaymentRequestStatusV2 = z.infer<typeof PaymentRequestStatusV2>;

/** Ephemeral Kora dynamic virtual account attempt (interaction-flow §3.2) */
export const ChargeAttemptStatus = z.enum([
  'account_active',
  'processing',
  'succeeded',
  'failed',
  'expired',
  'superseded',
]);
export type ChargeAttemptStatus = z.infer<typeof ChargeAttemptStatus>;

/** Work execution status — strictly separate from payment status (interaction-flow §3.3) */
export const JobWorkStatus = z.enum([
  'awaiting_payment',
  'ready',
  'in_progress',
  'completed',
  'on_hold',
  'cancelled',
]);
export type JobWorkStatus = z.infer<typeof JobWorkStatus>;

/** Payment terms & fee handling */
export const PaymentTermsV2 = z.enum(['FULL', 'DEPOSIT', 'PAY_ON_DELIVERY']);
export type PaymentTermsV2 = z.infer<typeof PaymentTermsV2>;

export const FeeBearer = z.enum(['OWNER', 'CLIENT']);
export type FeeBearer = z.infer<typeof FeeBearer>;

export const BusinessType = z.enum([
  'CREATIVE_DESIGN',
  'DIGITAL_SERVICES',
  'REPAIRS_MAINTENANCE',
  'PRINTING_PRODUCTION',
  'OTHER',
]);
export type BusinessType = z.infer<typeof BusinessType>;

/** Needs Attention exception types (interaction-flow §6.9) */
export const ReviewKindV2 = z.enum([
  'EXTRA_PAYMENT',
  'UNKNOWN_REFERENCE',
  'PAID_ON_CANCELLED',
  'VERIFICATION_MISMATCH',
  'REFUND_RECORDED',
  'VERIFICATION_FAILED',
]);
export type ReviewKindV2 = z.infer<typeof ReviewKindV2>;

export const ReviewStatusV2 = z.enum(['OPEN', 'HANDLED']);
export type ReviewStatusV2 = z.infer<typeof ReviewStatusV2>;

/* ---------- 2. Working Hours & Business Profile ---------- */

export const DayKey = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
export type DayKey = z.infer<typeof DayKey>;

export const DaySchedule = z.object({
  enabled: z.boolean(),
  start: z.string().regex(/^\d{2}:\d{2}$/), // e.g. "09:00"
  end: z.string().regex(/^\d{2}:\d{2}$/),   // e.g. "17:00"
});
export type DaySchedule = z.infer<typeof DaySchedule>;

export const WorkingHours = z.record(DayKey, DaySchedule);
export type WorkingHours = z.infer<typeof WorkingHours>;

export const ProviderV2 = z.object({
  id,
  email: z.string().email().nullable(),
  emailVerified: z.boolean(),
  fullName: z.string().nullable(),
  businessName: z.string(),
  businessType: BusinessType.nullable(),
  phoneE164: z.string().nullable(),
  showPhoneOnPayPage: z.boolean(),
  onboardingStep: z.number().int().min(1).max(4), // 4 = complete
  onboardedAt: iso.nullable(),
  workingHours: WorkingHours,
  weeklyAvailableHours: z.number(),
  defaultPaymentTerms: PaymentTermsV2,
  defaultDepositPercent: z.number().int().min(10).max(90),
  defaultFeeBearer: FeeBearer,
  whatsappTemplate: z.string(),
  dueSoonReminderDays: z.number().int().min(1).max(3),
  checklistDismissed: z.boolean(),
  createdAt: iso,
});
export type ProviderV2 = z.infer<typeof ProviderV2>;

/* ---------- 3. Charge Attempts, Requests, Jobs, Activity ---------- */

export const ChargeAttempt = z.object({
  id,
  requestId: id,
  status: ChargeAttemptStatus,
  koraReference: z.string(),
  bankName: z.string(),
  accountName: z.string(),
  accountNumberMasked: z.string(), // full only while account_active on pay page; last 4 after expiry
  expiresAt: iso,
  createdAt: iso,
  supersededAt: iso.nullable(),
});
export type ChargeAttempt = z.infer<typeof ChargeAttempt>;

export const PaymentRequestV2 = z.object({
  id,
  jobId: id,
  kind: z.enum(['FULL', 'DEPOSIT', 'BALANCE']),
  status: PaymentRequestStatusV2,
  isOverdue: z.boolean(),
  expectedAmountKobo: KoboString,
  acceptedAmountKobo: KoboString.nullable(),
  feeKobo: KoboString.nullable(),
  netKobo: KoboString.nullable(),
  feeBearer: FeeBearer,
  publicToken: z.string(),
  payLink: z.string(),
  payerName: z.string().nullable(),
  payerBank: z.string().nullable(),
  payerAccountMasked: z.string().nullable(),
  koraReference: z.string().nullable(),
  attemptCount: z.number().int(),
  activeAttempt: ChargeAttempt.nullable(),
  lastCheckedAt: iso.nullable(),
  paidAt: iso.nullable(),
  createdAt: iso,
});
export type PaymentRequestV2 = z.infer<typeof PaymentRequestV2>;

export const JobSummaryV2 = z.object({
  id,
  title: z.string(),
  description: z.string(),
  client: z.object({
    id,
    name: z.string(),
    phoneE164: z.string().nullable(),
    email: z.string().nullable(),
  }),
  workStatus: JobWorkStatus,
  paymentTerms: PaymentTermsV2,
  depositPercent: z.number().int().nullable(),
  feeBearer: FeeBearer,
  totalKobo: KoboString,
  verifiedPaidKobo: KoboString,
  balanceKobo: KoboString,
  dueDate: iso.nullable(),
  estimatedHours: z.number().nullable(),
  isOverdue: z.boolean(),
  isAtRisk: z.boolean(),
  startedWithoutPayment: z.boolean(),
  depositPaid: z.boolean(),
  isSample: z.boolean(),
  createdAt: iso,
});
export type JobSummaryV2 = z.infer<typeof JobSummaryV2>;

export const ActivityEvent = z.object({
  id,
  actor: z.enum(['OWNER', 'CLIENT', 'KORA', 'SYSTEM']),
  category: z.enum(['PAYMENTS', 'STATUS', 'EDITS']),
  eventType: z.string(),
  summary: z.string(),
  detail: z.string().nullable(),
  at: iso,
});
export type ActivityEvent = z.infer<typeof ActivityEvent>;

/* ---------- 4. Queue, Capacity & Public Surfaces ---------- */

export const QueueJobItem = JobSummaryV2.extend({
  rank: z.number().int().nullable(),
  priorityScore: z.number().optional(),
  priorityBreakdown: z
    .object({
      deadlineUrgency: z.number(),
      paymentReadiness: z.number(),
      customerPriority: z.number(),
      effortSuitability: z.number(),
      dependencyReadiness: z.number(),
    })
    .optional(),
  recommendedSlot: z
    .object({
      startIso: z.string(),
      endIso: z.string(),
      dayLabel: z.string(),
      hasConflict: z.boolean(),
    })
    .nullable()
    .optional(),
  scheduleApproved: z.boolean().optional(),
  approvedSlotLabel: z.string().nullable().optional(),
  reasonLabel: z.string(), // e.g. "Overdue · Paid", "Due tomorrow · 4h est."
});
export type QueueJobItem = z.infer<typeof QueueJobItem>;

export const QueueResponse = z.object({
  capacity: z.object({
    committedHours: z.number(),
    availableHours: z.number(),
    utilizationPercent: z.number(),
    overByHours: z.number(),
  }),
  inProgress: z.array(QueueJobItem),
  ready: z.array(QueueJobItem),
  waitingForPayment: z.array(QueueJobItem),
});
export type QueueResponse = z.infer<typeof QueueResponse>;

export const PublicPayResponseV2 = z.object({
  requestStatus: PaymentRequestStatusV2,
  kind: z.enum(['FULL', 'DEPOSIT', 'BALANCE']),
  businessName: z.string(),
  businessPhone: z.string().nullable(),
  jobTitle: z.string(),
  jobDescription: z.string(),
  dueDate: iso.nullable(),
  expectedAmountKobo: KoboString,
  acceptedAmountKobo: KoboString.nullable(),
  feeBearer: FeeBearer,
  isTestMode: z.boolean(),
  isPreview: z.boolean(),
  serverNow: iso,
  activeAttempt: z.object({
    id,
    status: ChargeAttemptStatus,
    bankName: z.string(),
    accountName: z.string(),
    accountNumber: z.string(),
    expiresAt: iso,
  }).nullable(),
  lastCheckedAt: iso.nullable(),
  receiptUrl: z.string().nullable(),
});
export type PublicPayResponseV2 = z.infer<typeof PublicPayResponseV2>;

export const PublicReceiptV2 = z.object({
  businessName: z.string(),
  businessPhone: z.string().nullable(),
  status: z.enum(['paid', 'refunded']),
  jobTitle: z.string(),
  jobDescription: z.string(),
  clientName: z.string(),
  payerName: z.string().nullable(),
  payerBank: z.string().nullable(),
  acceptedAmountKobo: KoboString,
  feeKobo: KoboString.nullable(),
  netKobo: KoboString.nullable(),
  koraReference: z.string(),
  requestReference: z.string(),
  paidAt: iso,
  isTestMode: z.boolean(),
});
export type PublicReceiptV2 = z.infer<typeof PublicReceiptV2>;

export const WaitlistBody = z.object({
  email: z.string().email(),
  whatsappPhone: z.string().optional(),
  businessType: BusinessType.optional(),
});
export type WaitlistBody = z.infer<typeof WaitlistBody>;
