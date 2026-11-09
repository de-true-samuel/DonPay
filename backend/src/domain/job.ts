import { sumKobo, type Kobo } from './money';

export type PaymentPlan = 'FULL' | 'DEPOSIT_BALANCE';
export type ReadyRule = 'AFTER_DEPOSIT' | 'AFTER_FULL';
export type PaymentSource = 'KORA_VERIFIED' | 'MANUAL';
export type JobStatus = 'NOT_STARTED' | 'PART_PAID' | 'FULLY_PAID' | 'CANCELLED';

export interface JobMoneyInput {
  totalKobo: Kobo;
  plan: PaymentPlan;
  depositKobo: Kobo | null;
  readyRule: ReadyRule;
  cancelledAt: Date | null;
  payments: { amountKobo: Kobo; source: PaymentSource }[];
}

export interface JobFinancials {
  paidKobo: Kobo;
  verifiedPaidKobo: Kobo;
  balanceKobo: Kobo;
  status: JobStatus;
  readyToStart: boolean;
  hasUnverifiedPayments: boolean;
  overpaid: boolean;
}

/** The amount of *verified* money that unlocks "Ready to start". */
export function readyThresholdKobo(job: Pick<JobMoneyInput, 'totalKobo' | 'plan' | 'depositKobo' | 'readyRule'>): Kobo {
  if (job.readyRule === 'AFTER_DEPOSIT' && job.plan === 'DEPOSIT_BALANCE' && job.depositKobo != null) {
    return job.depositKobo;
  }
  return job.totalKobo;
}

/**
 * Balances are derived, never stored. Manual (unverified) payments count towards what's
 * been paid, but never towards "Ready to start".
 */
export function computeJobFinancials(job: JobMoneyInput): JobFinancials {
  const paidKobo = sumKobo(job.payments.map((p) => p.amountKobo));
  const verifiedPaidKobo = sumKobo(job.payments.filter((p) => p.source === 'KORA_VERIFIED').map((p) => p.amountKobo));
  const rawBalance = job.totalKobo - paidKobo;

  let status: JobStatus;
  if (job.cancelledAt) status = 'CANCELLED';
  else if (paidKobo <= 0n) status = 'NOT_STARTED';
  else if (paidKobo < job.totalKobo) status = 'PART_PAID';
  else status = 'FULLY_PAID';

  return {
    paidKobo,
    verifiedPaidKobo,
    balanceKobo: rawBalance,
    status,
    readyToStart: !job.cancelledAt && verifiedPaidKobo >= readyThresholdKobo(job),
    hasUnverifiedPayments: job.payments.some((p) => p.source === 'MANUAL'),
    overpaid: rawBalance < 0n,
  };
}

/** Amount for the job's first request, based on its plan. */
export function firstRequestFor(job: { plan: PaymentPlan; totalKobo: Kobo; depositKobo: Kobo | null }): {
  kind: 'FULL' | 'DEPOSIT';
  amountKobo: Kobo;
} {
  if (job.plan === 'DEPOSIT_BALANCE') {
    if (job.depositKobo == null) throw new Error('Deposit plan requires depositKobo');
    return { kind: 'DEPOSIT', amountKobo: job.depositKobo };
  }
  return { kind: 'FULL', amountKobo: job.totalKobo };
}

export function validateJobAmounts(input: { plan: PaymentPlan; totalKobo: Kobo; depositKobo: Kobo | null | undefined }): string | null {
  if (input.totalKobo <= 0n) return 'totalKobo must be greater than zero';
  if (input.plan === 'DEPOSIT_BALANCE') {
    if (input.depositKobo == null) return 'depositKobo is required for a deposit-and-balance plan';
    if (input.depositKobo <= 0n) return 'depositKobo must be greater than zero';
    if (input.depositKobo >= input.totalKobo) return 'depositKobo must be less than totalKobo';
  } else if (input.depositKobo != null) {
    return 'depositKobo is only allowed for a deposit-and-balance plan';
  }
  return null;
}
