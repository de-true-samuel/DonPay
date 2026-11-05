/**
 * Response types of the backend ↔ frontend contract. Mirrors /contract.md (v1.0.0).
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
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  messageConsent: boolean;
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

export interface PreparedMessage {
  text: string;
  whatsappUrl: string;
  telegramUrl: string;
  payLink: string;
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
  counts: { justPaid: number; waiting: number; balancesDue: number; expired: number; needsReview: number };
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
  businessName: string;
  customerFirstName: string;
  service: string;
  kind: RequestKind;
  amountKobo: KoboString;
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  receipt: null | {
    amountKobo: KoboString;
    paidAt: string;
    reference: string;
    jobTotalKobo: KoboString;
    jobPaidKobo: KoboString;
    jobBalanceKobo: KoboString;
  };
}
