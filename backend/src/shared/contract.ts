/**
 * Response types of the backend ↔ frontend contract. Mirrors /contract.md (v1.1.0).
 * The frontend may copy this file verbatim; it has no imports.
 */

/** Whole kobo as a decimal string. "2500000" = ₦25,000.00 */
export type KoboString = string;

export type PaymentPlan = 'FULL' | 'DEPOSIT_BALANCE';
export type ReadyRule = 'AFTER_DEPOSIT' | 'AFTER_FULL';
export type RequestKind = 'FULL' | 'DEPOSIT' | 'BALANCE' | 'CUSTOM';
export type RequestStatus = 'DRAFT' | 'SCHEDULED' | 'SENT' | 'PAID' | 'EXPIRED' | 'CANCELLED';
export type JobStatus = 'NOT_STARTED' | 'PART_PAID' | 'FULLY_PAID' | 'CANCELLED';
export type PaymentSource = 'KORA_VERIFIED' | 'MANUAL';
export type ReviewKind =
  | 'UNMATCHED_REFERENCE'
  | 'PAID_AFTER_EXPIRY'
  | 'JOB_OVERPAID'
  | 'AMOUNT_MISMATCH'
  | 'PAYER_NAME_DIFFERS'
  | 'VERIFICATION_FAILED';
export type SearchStatus = 'paid' | 'waiting' | 'balance_due' | 'expired' | 'needs_review';
export type SavedView = 'unpaid_balances' | 'this_week' | 'needs_follow_up';
/** Wording template for messages copied to a customer. null on a customer means 'en'. */
export type MessageLanguage = 'en' | 'pcm';

export const CONTRACT_VERSION = '1.1.0';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'CSRF_HEADER_MISSING'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'OPEN_REQUEST_EXISTS'
  | 'INVALID_STATE'
  | 'NOTHING_OWED'
  | 'RATE_LIMITED'
  | 'KORA_UNAVAILABLE'
  | 'REQUEST_NOT_WAITING'
  | 'REQUEST_EXPIRED'
  | 'JOB_NOT_READY'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'IDEMPOTENCY_IN_PROGRESS'
  | 'INTERNAL';

export interface ApiError {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Provider {
  id: string;
  businessName: string;
  telegramLinked: boolean;
  defaultReadyRule: ReadyRule;
  digestTime: string | null;
  /** Business phone (E.164) shown to customers on expired/cancelled pages. */
  phone: string | null;
  onboardedAt: string | null;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  /** @deprecated 1.1.0: accepted on input, ignored, always false. Removed in 2.0. */
  messageConsent: boolean;
  messageLanguage: MessageLanguage | null;
  createdAt: string;
}

export interface CustomerSummary extends Customer {
  jobCount: number;
  outstandingKobo: KoboString;
  lastActivityAt: string;
}

export interface CustomerRef {
  id: string;
  name: string;
  phone: string;
}

export interface PaymentRequest {
  id: string;
  jobId: string;
  kind: RequestKind;
  amountKobo: KoboString;
  status: RequestStatus;
  payLink: string;
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
  expiresAt: string | null;
  scheduledFor: string | null;
  sentAt: string | null;
  paidAt: string | null;
  detailsCopiedAt: string | null;
  customerClaimedPaidAt: string | null;
  createdAt: string;
}

export interface Payment {
  id: string;
  jobId: string;
  requestId: string | null;
  source: PaymentSource;
  amountKobo: KoboString;
  payerName: string | null;
  payerBank: string | null;
  payerAccountMasked: string | null;
  payerDetailsSimulated: boolean;
  note: string | null;
  receivedAt: string;
  createdAt: string;
}

export interface JobSummary {
  id: string;
  customer: CustomerRef;
  service: string;
  totalKobo: KoboString;
  plan: PaymentPlan;
  depositKobo: KoboString | null;
  balanceDueAt: string | null;
  readyRule: ReadyRule;
  notes: string | null;
  status: JobStatus;
  paidKobo: KoboString;
  verifiedPaidKobo: KoboString;
  balanceKobo: KoboString;
  readyToStart: boolean;
  hasUnverifiedPayments: boolean;
  openRequest: PaymentRequest | null;
  createdAt: string;
  cancelledAt: string | null;
}

export interface ReviewItem {
  id: string;
  kind: ReviewKind;
  message: string;
  jobId: string | null;
  requestId: string | null;
  paymentId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
}

export interface JobDetail extends JobSummary {
  requests: PaymentRequest[];
  payments: Payment[];
  openReviewItems: ReviewItem[];
}

/** Exactly the values embedded in PreparedMessage.text, for copy buttons. */
export interface PaymentDetails {
  bankName: string;
  /** String: keeps leading zeros. */
  accountNumber: string;
  accountName: string;
  /** Integer kobo as a JSON number, e.g. 2500000. */
  amountKobo: number;
  /** Digits, two decimals, no ₦ and no commas: "25000.00". Pastes cleanly into a bank app. */
  amountPlain: string;
  expiresAt: string;
}

export interface PreparedMessage {
  text: string;
  whatsappUrl: string;
  telegramUrl: string;
  payLink: string;
  /** Set when the message carries account details (payment details, nudge); null otherwise. */
  details: PaymentDetails | null;
  language: MessageLanguage;
}

export interface RequestWithMessage {
  request: PaymentRequest;
  job: JobSummary;
  message: PreparedMessage | null;
}

export interface TimelineEvent {
  type:
    | 'JOB_CREATED'
    | 'REQUEST_SENT'
    | 'PAYMENT_RECEIVED'
    | 'MANUAL_PAYMENT'
    | 'REQUEST_EXPIRED'
    | 'REQUEST_CANCELLED'
    | 'JOB_CANCELLED';
  at: string;
  jobId: string;
  service: string;
  requestId: string | null;
  paymentId: string | null;
  amountKobo: KoboString | null;
  label: string;
}

export interface CustomerPage {
  customer: CustomerSummary;
  jobs: JobSummary[];
  timeline: TimelineEvent[];
}

export interface ImportResult {
  created: number;
  skipped: number;
  errors: { line: number; message: string }[];
}

export interface TodayResponse {
  generatedAt: string;
  justPaid: { payment: Payment; job: JobSummary }[];
  waiting: { request: PaymentRequest; job: JobSummary }[];
  balancesDue: JobSummary[];
  expired: { request: PaymentRequest; job: JobSummary }[];
  needsReview: ReviewItem[];
  /** Scheduled requests whose reminder time has passed and that have no account yet. */
  dueReminders: { request: PaymentRequest; job: JobSummary }[];
  counts: { justPaid: number; waiting: number; balancesDue: number; expired: number; needsReview: number; dueReminders: number };
}

export interface SearchResponse extends Page<JobSummary> {
  interpreted: { text: string | null; phone: string | null; amountKobo: KoboString | null };
}

export interface AuthResponse {
  sessionToken: string;
  provider: Provider;
}

export interface PublicRequest {
  status: RequestStatus;
  serverNow: string;
  businessPhone: string | null;
  businessName: string;
  customerFirstName: string;
  service: string;
  kind: RequestKind;
  amountKobo: KoboString;
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
  amountPlain: string;
  expiresAt: string | null;
  paidAt: string | null;
  receipt: null | {
    amountKobo: KoboString;
    paidAt: string;
    reference: string;
    jobTotalKobo: KoboString;
    jobPaidKobo: KoboString;
    jobBalanceKobo: KoboString;
    balanceDueAt: string | null;
  };
}

export type PublicState = 'waiting' | 'paid' | 'expired' | 'cancelled' | 'not_ready';

/** GET /p/:token/status. Small on purpose: polled every few seconds on weak connections. */
export interface PublicStatus {
  state: PublicState;
  /** Server clock, so the page can correct a wrong phone clock. */
  serverNow: string;
  expiresAt: string | null;
  receipt?: {
    amountKobo: number;
    reference: string;
    paidAt: string;
    balanceKobo?: number;
    balanceDueDate?: string;
  };
}

/** GET /api/me/export */
export interface AccountExport {
  exportedAt: string;
  contractVersion: string;
  provider: Provider;
  customers: Customer[];
  jobs: JobDetail[];
}

/** GET /api/admin/support/requests/:reference (read-only support view). */
export interface SupportRequestView {
  request: PaymentRequest & { koraReference: string | null; providerId: string; publicToken?: never };
  businessName: string;
  job: { id: string; service: string; totalKobo: KoboString; cancelledAt: string | null };
  payment: Payment | null;
  webhookEvents: { id: string; eventType: string; signatureOk: boolean; receivedAt: string; processedAt: string | null; error: string | null }[];
  reviewItems: ReviewItem[];
  claims: { at: string }[];
  notifications: { kind: string; createdAt: string; sentAt: string | null; failedAt: string | null; attempts: number; lastError: string | null }[];
}
