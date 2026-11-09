/**
 * Mirrors "Kobo-Exact: Backend ↔ Frontend Contract" v1.0.0.
 * Types are inferred from the Zod schemas so there is one source of truth.
 * If the backend contract changes, change it here and bump CONTRACT_VERSION.
 */
import { z } from 'zod';

export const CONTRACT_VERSION = '1.0.0';

/** Whole kobo as a decimal string. Never a float. ₦1 = 100 kobo. */
export const KoboString = z.string().regex(/^-?\d+$/);
export type KoboString = z.infer<typeof KoboString>;

const id = z.string();
const iso = z.string();

/* ---------- enums ---------- */
export const PaymentPlan = z.enum(['FULL', 'DEPOSIT_BALANCE']);
export type PaymentPlan = z.infer<typeof PaymentPlan>;
export const ReadyRule = z.enum(['AFTER_DEPOSIT', 'AFTER_FULL']);
export type ReadyRule = z.infer<typeof ReadyRule>;
export const RequestKind = z.enum(['FULL', 'DEPOSIT', 'BALANCE', 'CUSTOM']);
export type RequestKind = z.infer<typeof RequestKind>;
export const RequestStatus = z.enum(['DRAFT', 'SCHEDULED', 'SENT', 'PAID', 'EXPIRED', 'CANCELLED']);
export type RequestStatus = z.infer<typeof RequestStatus>;
export const JobStatus = z.enum(['NOT_STARTED', 'PART_PAID', 'FULLY_PAID', 'CANCELLED']);
export type JobStatus = z.infer<typeof JobStatus>;
export const PaymentSource = z.enum(['KORA_VERIFIED', 'MANUAL']);
export type PaymentSource = z.infer<typeof PaymentSource>;
export const ReviewKind = z.enum([
  'UNMATCHED_REFERENCE', 'PAID_AFTER_EXPIRY', 'JOB_OVERPAID',
  'AMOUNT_MISMATCH', 'PAYER_NAME_DIFFERS', 'VERIFICATION_FAILED',
]);
export type ReviewKind = z.infer<typeof ReviewKind>;
export const SearchStatus = z.enum(['paid', 'waiting', 'balance_due', 'expired', 'needs_review']);
export type SearchStatus = z.infer<typeof SearchStatus>;
export const SavedView = z.enum(['unpaid_balances', 'this_week', 'needs_follow_up']);
export type SavedView = z.infer<typeof SavedView>;

export const ErrorCode = z.enum([
  'VALIDATION_ERROR', 'UNAUTHENTICATED', 'CSRF_HEADER_MISSING', 'FORBIDDEN', 'NOT_FOUND',
  'CONFLICT', 'OPEN_REQUEST_EXISTS', 'INVALID_STATE', 'NOTHING_OWED', 'RATE_LIMITED',
  'KORA_UNAVAILABLE', 'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/* ---------- core objects ---------- */
export const Provider = z.object({
  id,
  businessName: z.string(),
  telegramLinked: z.boolean(),
  defaultReadyRule: ReadyRule,
  digestTime: z.string().nullable(),
  createdAt: iso,
});
export type Provider = z.infer<typeof Provider>;

export const Customer = z.object({
  id, name: z.string(), phone: z.string(), messageConsent: z.boolean(), createdAt: iso,
});
export type Customer = z.infer<typeof Customer>;

export const CustomerSummary = Customer.extend({
  jobCount: z.number(), outstandingKobo: KoboString, lastActivityAt: iso,
});
export type CustomerSummary = z.infer<typeof CustomerSummary>;

export const CustomerRef = z.object({ id, name: z.string(), phone: z.string() });
export type CustomerRef = z.infer<typeof CustomerRef>;

export const PaymentRequest = z.object({
  id, jobId: id, kind: RequestKind, amountKobo: KoboString, status: RequestStatus,
  payLink: z.string(),
  bankName: z.string().nullable(), accountNumber: z.string().nullable(), accountName: z.string().nullable(),
  expiresAt: iso.nullable(), scheduledFor: iso.nullable(), sentAt: iso.nullable(), paidAt: iso.nullable(),
  createdAt: iso,
});
export type PaymentRequest = z.infer<typeof PaymentRequest>;

export const Payment = z.object({
  id, jobId: id, requestId: id.nullable(), source: PaymentSource, amountKobo: KoboString,
  payerName: z.string().nullable(), payerBank: z.string().nullable(), payerAccountMasked: z.string().nullable(),
  payerDetailsSimulated: z.boolean(), note: z.string().nullable(), receivedAt: iso, createdAt: iso,
});
export type Payment = z.infer<typeof Payment>;

export const PreparedMessage = z.object({
  text: z.string(), whatsappUrl: z.string(), telegramUrl: z.string(), payLink: z.string(),
});
export type PreparedMessage = z.infer<typeof PreparedMessage>;

export const ReviewItem = z.object({
  id, kind: ReviewKind, message: z.string(),
  jobId: id.nullable(), requestId: id.nullable(), paymentId: id.nullable(),
  detail: z.record(z.unknown()), createdAt: iso, resolvedAt: iso.nullable(), resolution: z.string().nullable(),
});
export type ReviewItem = z.infer<typeof ReviewItem>;

export const JobSummary = z.object({
  id, customer: CustomerRef, service: z.string(), totalKobo: KoboString, plan: PaymentPlan,
  depositKobo: KoboString.nullable(), balanceDueAt: iso.nullable(), readyRule: ReadyRule,
  notes: z.string().nullable(), status: JobStatus,
  paidKobo: KoboString, verifiedPaidKobo: KoboString, balanceKobo: KoboString,
  readyToStart: z.boolean(), hasUnverifiedPayments: z.boolean(),
  openRequest: PaymentRequest.nullable(), createdAt: iso, cancelledAt: iso.nullable(),
});
export type JobSummary = z.infer<typeof JobSummary>;

export const JobDetail = JobSummary.extend({
  requests: z.array(PaymentRequest), payments: z.array(Payment), openReviewItems: z.array(ReviewItem),
});
export type JobDetail = z.infer<typeof JobDetail>;

export const TimelineEvent = z.object({
  type: z.enum([
    'JOB_CREATED', 'REQUEST_SENT', 'PAYMENT_RECEIVED', 'MANUAL_PAYMENT',
    'REQUEST_EXPIRED', 'REQUEST_CANCELLED', 'JOB_CANCELLED',
  ]),
  at: iso, jobId: id, service: z.string(), requestId: id.nullable(), paymentId: id.nullable(),
  amountKobo: KoboString.nullable(), label: z.string(),
});
export type TimelineEvent = z.infer<typeof TimelineEvent>;

/* ---------- envelopes ---------- */
export const pageOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });
export interface Page<T> { items: T[]; nextCursor: string | null }

export const ApiErrorBody = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

export const TodayResponse = z.object({
  generatedAt: iso,
  justPaid: z.array(z.object({ payment: Payment, job: JobSummary })),
  waiting: z.array(z.object({ request: PaymentRequest, job: JobSummary })),
  balancesDue: z.array(JobSummary),
  expired: z.array(z.object({ request: PaymentRequest, job: JobSummary })),
  needsReview: z.array(ReviewItem),
  counts: z.object({
    justPaid: z.number(), waiting: z.number(), balancesDue: z.number(),
    expired: z.number(), needsReview: z.number(),
  }),
});
export type TodayResponse = z.infer<typeof TodayResponse>;

export const RequestWithMessage = z.object({
  request: PaymentRequest, job: JobSummary, message: PreparedMessage.nullable(),
});
export type RequestWithMessage = z.infer<typeof RequestWithMessage>;

export const CustomerPage = z.object({
  customer: CustomerSummary, jobs: z.array(JobSummary), timeline: z.array(TimelineEvent),
});
export type CustomerPage = z.infer<typeof CustomerPage>;

export const SearchResponse = pageOf(JobSummary).extend({
  interpreted: z.object({
    text: z.string().nullable(), phone: z.string().nullable(), amountKobo: KoboString.nullable(),
  }),
});
export type SearchResponse = z.infer<typeof SearchResponse>;

export const ImportResult = z.object({
  created: z.number(), skipped: z.number(),
  errors: z.array(z.object({ line: z.number(), message: z.string() })),
});
export type ImportResult = z.infer<typeof ImportResult>;

export const PublicRequest = z.object({
  status: RequestStatus, businessName: z.string(), customerFirstName: z.string(), service: z.string(),
  kind: RequestKind, amountKobo: KoboString,
  bankName: z.string().nullable(), accountNumber: z.string().nullable(), accountName: z.string().nullable(),
  expiresAt: iso.nullable(), paidAt: iso.nullable(),
  receipt: z.object({
    amountKobo: KoboString, paidAt: iso, reference: z.string(),
    jobTotalKobo: KoboString, jobPaidKobo: KoboString, jobBalanceKobo: KoboString,
  }).nullable(),
});
export type PublicRequest = z.infer<typeof PublicRequest>;

/* ---------- auth / me ---------- */
export const AuthExchangeResponse = z.object({ sessionToken: z.string(), provider: Provider });
export type AuthExchangeResponse = z.infer<typeof AuthExchangeResponse>;
export const TelegramLinkResponse = z.object({ url: z.string(), expiresAt: iso });
export type TelegramLinkResponse = z.infer<typeof TelegramLinkResponse>;
export interface PatchMeBody { businessName?: string; defaultReadyRule?: ReadyRule; digestTime?: string | null }

/* ---------- Phase 2: jobs, requests, dev simulation ---------- */
export const JobPage = pageOf(JobSummary);
export type JobPage = z.infer<typeof JobPage>;

export interface CreateJobBody {
  customerId?: string;
  customer?: { name: string; phone: string; messageConsent?: boolean };
  service: string;
  totalKobo: KoboString;
  plan: PaymentPlan;
  depositKobo?: KoboString;
  balanceDueAt?: string | null;
  readyRule?: ReadyRule;
  notes?: string;
}

export const SimulateResult = z.object({
  outcome: z.enum(['recorded', 'duplicate']),
  paymentId: z.string().nullable(),
});
export type SimulateResult = z.infer<typeof SimulateResult>;

/* ---------- Phase 3: customers, job edits, manual payments ---------- */
export const CustomerListPage = pageOf(CustomerSummary);
export type CustomerListPage = z.infer<typeof CustomerListPage>;

export interface CreateCustomerBody { name: string; phone: string; messageConsent?: boolean }
export interface PatchCustomerBody { name?: string; phone?: string; messageConsent?: boolean }
export interface PatchJobBody { service?: string; notes?: string | null; balanceDueAt?: string | null; readyRule?: ReadyRule }
export interface ManualPaymentBody { amountKobo: KoboString; note?: string; receivedAt?: string }

/* ---------- Phase 4: search, review, export ---------- */
export const ReviewPage = pageOf(ReviewItem);
export type ReviewPage = z.infer<typeof ReviewPage>;
export interface ResolveBody { resolution: string; cancelRequestId?: string }
export interface SearchParams {
  q?: string; status?: string; from?: string; to?: string; view?: SavedView; limit?: number; cursor?: string;
}
