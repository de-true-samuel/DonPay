/**
 * contract.md v1.1.0 as strict Zod schemas. Every e2e response is validated against these:
 * a missing, extra or wrongly-typed field fails the run. Written from contract.md, NOT from the
 * backend's own types, so they catch drift between the document and the code.
 */
import { z } from 'zod';

const kobo = z.string().regex(/^-?\d+$/, 'KoboString');
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/, 'ISO UTC timestamp');
const id = z.string().min(10);
const e164 = z.string().regex(/^\+234\d{10}$/);
const url = z.string().regex(/^https?:\/\//);

export const enums = {
  plan: z.enum(['FULL', 'DEPOSIT_BALANCE']),
  ready: z.enum(['AFTER_DEPOSIT', 'AFTER_FULL']),
  kind: z.enum(['FULL', 'DEPOSIT', 'BALANCE', 'CUSTOM']),
  reqStatus: z.enum(['DRAFT', 'SCHEDULED', 'SENT', 'PAID', 'EXPIRED', 'CANCELLED']),
  jobStatus: z.enum(['NOT_STARTED', 'PART_PAID', 'FULLY_PAID', 'CANCELLED']),
  source: z.enum(['KORA_VERIFIED', 'MANUAL']),
  review: z.enum(['UNMATCHED_REFERENCE', 'PAID_AFTER_EXPIRY', 'JOB_OVERPAID', 'AMOUNT_MISMATCH', 'PAYER_NAME_DIFFERS', 'VERIFICATION_FAILED']),
  language: z.enum(['en', 'pcm']),
  publicState: z.enum(['waiting', 'paid', 'expired', 'cancelled', 'not_ready']),
};

export const ApiError = z.strictObject({
  error: z.strictObject({
    code: z.enum([
      'VALIDATION_ERROR', 'UNAUTHENTICATED', 'CSRF_HEADER_MISSING', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT',
      'OPEN_REQUEST_EXISTS', 'INVALID_STATE', 'NOTHING_OWED', 'RATE_LIMITED', 'KORA_UNAVAILABLE',
      'REQUEST_NOT_WAITING', 'REQUEST_EXPIRED', 'JOB_NOT_READY', 'IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_IN_PROGRESS', 'INTERNAL',
    ]),
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
});

export const Provider = z.strictObject({
  id,
  businessName: z.string(),
  telegramLinked: z.boolean(),
  defaultReadyRule: enums.ready,
  digestTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  phone: e164.nullable(),
  onboardedAt: iso.nullable(),
  createdAt: iso,
});

export const Customer = z.strictObject({
  id,
  name: z.string(),
  phone: e164,
  messageConsent: z.literal(false), // deprecated in 1.1.0: always false
  messageLanguage: enums.language.nullable(),
  createdAt: iso,
});
export const CustomerSummary = Customer.extend({ jobCount: z.number().int(), outstandingKobo: kobo, lastActivityAt: iso }).strict();

export const PaymentRequest = z.strictObject({
  id,
  jobId: id,
  kind: enums.kind,
  amountKobo: kobo,
  status: enums.reqStatus,
  payLink: url,
  bankName: z.string().nullable(),
  accountNumber: z.string().nullable(),
  accountName: z.string().nullable(),
  expiresAt: iso.nullable(),
  scheduledFor: iso.nullable(),
  sentAt: iso.nullable(),
  paidAt: iso.nullable(),
  detailsCopiedAt: iso.nullable(),
  customerClaimedPaidAt: iso.nullable(),
  createdAt: iso,
});

export const Payment = z.strictObject({
  id,
  jobId: id,
  requestId: id.nullable(),
  source: enums.source,
  amountKobo: kobo,
  payerName: z.string().nullable(),
  payerBank: z.string().nullable(),
  payerAccountMasked: z.string().nullable(),
  payerDetailsSimulated: z.boolean(),
  note: z.string().nullable(),
  receivedAt: iso,
  createdAt: iso,
});

export const ReviewItem = z.strictObject({
  id,
  kind: enums.review,
  message: z.string().min(1),
  jobId: id.nullable(),
  requestId: id.nullable(),
  paymentId: id.nullable(),
  detail: z.record(z.string(), z.unknown()),
  createdAt: iso,
  resolvedAt: iso.nullable(),
  resolution: z.string().nullable(),
});

export const JobSummary = z.strictObject({
  id,
  customer: z.strictObject({ id, name: z.string(), phone: e164 }),
  service: z.string(),
  totalKobo: kobo,
  plan: enums.plan,
  depositKobo: kobo.nullable(),
  balanceDueAt: iso.nullable(),
  readyRule: enums.ready,
  notes: z.string().nullable(),
  status: enums.jobStatus,
  paidKobo: kobo,
  verifiedPaidKobo: kobo,
  balanceKobo: kobo,
  readyToStart: z.boolean(),
  hasUnverifiedPayments: z.boolean(),
  openRequest: PaymentRequest.nullable(),
  createdAt: iso,
  cancelledAt: iso.nullable(),
});

export const JobDetail = JobSummary.extend({
  requests: z.array(PaymentRequest),
  payments: z.array(Payment),
  openReviewItems: z.array(ReviewItem),
}).strict();

export const PreparedMessage = z.strictObject({
  text: z.string().min(1),
  whatsappUrl: z.string().regex(/^https:\/\/wa\.me\/\d*\?text=/),
  telegramUrl: z.string().regex(/^https:\/\/t\.me\/share\/url\?url=/),
  payLink: url,
  details: z
    .strictObject({
      bankName: z.string().min(1),
      accountNumber: z.string().regex(/^\d{10}$/),
      accountName: z.string().min(1),
      amountKobo: z.number().int().positive(),
      amountPlain: z.string().regex(/^\d+\.\d{2}$/),
      expiresAt: iso,
    })
    .nullable(),
  language: enums.language,
});

export const RequestWithMessage = z.strictObject({ request: PaymentRequest, job: JobSummary, message: PreparedMessage.nullable() });

export const page = <T extends z.ZodType>(item: T) => z.strictObject({ items: z.array(item), nextCursor: z.string().nullable() });

export const TimelineEvent = z.strictObject({
  type: z.enum(['JOB_CREATED', 'REQUEST_SENT', 'PAYMENT_RECEIVED', 'MANUAL_PAYMENT', 'REQUEST_EXPIRED', 'REQUEST_CANCELLED', 'JOB_CANCELLED']),
  at: iso,
  jobId: id,
  service: z.string(),
  requestId: id.nullable(),
  paymentId: id.nullable(),
  amountKobo: kobo.nullable(),
  label: z.string(),
});

export const CustomerPage = z.strictObject({ customer: CustomerSummary, jobs: z.array(JobSummary), timeline: z.array(TimelineEvent) });
export const ImportResult = z.strictObject({
  created: z.number().int(),
  skipped: z.number().int(),
  errors: z.array(z.strictObject({ line: z.number().int(), message: z.string() })),
});

export const TodayResponse = z.strictObject({
  generatedAt: iso,
  justPaid: z.array(z.strictObject({ payment: Payment, job: JobSummary })),
  waiting: z.array(z.strictObject({ request: PaymentRequest, job: JobSummary })),
  balancesDue: z.array(JobSummary),
  expired: z.array(z.strictObject({ request: PaymentRequest, job: JobSummary })),
  needsReview: z.array(ReviewItem),
  dueReminders: z.array(z.strictObject({ request: PaymentRequest, job: JobSummary })),
  counts: z.strictObject({
    dueReminders: z.number().int(),
    justPaid: z.number().int(),
    waiting: z.number().int(),
    balancesDue: z.number().int(),
    expired: z.number().int(),
    needsReview: z.number().int(),
  }),
});

export const SearchResponse = page(JobSummary)
  .extend({ interpreted: z.strictObject({ text: z.string().nullable(), phone: z.string().nullable(), amountKobo: kobo.nullable() }) })
  .strict();

export const AuthResponse = z.strictObject({ sessionToken: z.string().min(20), provider: Provider });

export const PublicRequest = z.strictObject({
  status: enums.reqStatus,
  serverNow: iso,
  businessPhone: e164.nullable(),
  amountPlain: z.string().regex(/^\d+\.\d{2}$/),
  businessName: z.string(),
  customerFirstName: z.string(),
  service: z.string(),
  kind: enums.kind,
  amountKobo: kobo,
  bankName: z.string().nullable(),
  accountNumber: z.string().nullable(),
  accountName: z.string().nullable(),
  expiresAt: iso.nullable(),
  paidAt: iso.nullable(),
  receipt: z
    .strictObject({
      amountKobo: kobo,
      paidAt: iso,
      reference: z.string(),
      jobTotalKobo: kobo,
      jobPaidKobo: kobo,
      jobBalanceKobo: kobo,
      balanceDueAt: iso.nullable(),
    })
    .nullable(),
});

export const PublicStatus = z.strictObject({
  state: enums.publicState,
  serverNow: iso,
  expiresAt: iso.nullable(),
  receipt: z
    .strictObject({
      amountKobo: z.number().int(),
      reference: z.string(),
      paidAt: iso,
      balanceKobo: z.number().int().optional(),
      balanceDueDate: iso.optional(),
    })
    .optional(),
});

export const ClaimResult = z.strictObject({ ok: z.literal(true) });

export const AccountExport = z.strictObject({
  exportedAt: iso,
  contractVersion: z.literal('1.1.0'),
  provider: Provider,
  customers: z.array(Customer),
  jobs: z.array(JobDetail),
});

export const TelegramLink = z.strictObject({ url: z.string().regex(/^https:\/\/t\.me\/\w+\?start=link_/), expiresAt: iso });
export const Health = z.strictObject({ ok: z.boolean(), db: z.boolean(), time: iso });
export const AdminHealth = z.strictObject({
  ok: z.boolean(),
  alerts: z.array(z.string()),
  unprocessedWebhooks: z.number().int(),
  oldestUnprocessedWebhookAt: iso.nullable(),
  unsentNotifications: z.number().int(),
  oldestUnsentNotificationAt: iso.nullable(),
  failedNotifications24h: z.number().int(),
  reconciliationBacklog: z.number().int(),
  oldestReconciliationDueAt: iso.nullable(),
  deadLetteredVerifications24h: z.number().int(),
  openReviewItems: z.number().int(),
  unattributedReviewItems: z.number().int(),
  deadLetterHint: z.string(),
});

export const SupportRequestView = z.strictObject({
  request: PaymentRequest.extend({ koraReference: z.string().nullable(), providerId: id }).strict(),
  businessName: z.string(),
  job: z.strictObject({ id, service: z.string(), totalKobo: kobo, cancelledAt: iso.nullable() }),
  payment: Payment.nullable(),
  webhookEvents: z.array(
    z.strictObject({ id, eventType: z.string(), signatureOk: z.boolean(), receivedAt: iso, processedAt: iso.nullable(), error: z.string().nullable() }),
  ),
  reviewItems: z.array(ReviewItem),
  claims: z.array(z.strictObject({ at: iso })),
  notifications: z.array(
    z.strictObject({ kind: z.string(), createdAt: iso, sentAt: iso.nullable(), failedAt: iso.nullable(), attempts: z.number().int(), lastError: z.string().nullable() }),
  ),
});
