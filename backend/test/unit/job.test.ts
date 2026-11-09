import { describe, expect, it } from 'vitest';
import { computeJobFinancials, firstRequestFor, readyThresholdKobo, validateJobAmounts, type JobMoneyInput } from '../../src/domain/job';

const base: JobMoneyInput = {
  totalKobo: 5_000_000n,
  plan: 'DEPOSIT_BALANCE',
  depositKobo: 2_500_000n,
  readyRule: 'AFTER_DEPOSIT',
  cancelledAt: null,
  payments: [],
};
const kora = (amountKobo: bigint) => ({ amountKobo, source: 'KORA_VERIFIED' as const });
const manual = (amountKobo: bigint) => ({ amountKobo, source: 'MANUAL' as const });

describe('computeJobFinancials', () => {
  it('nothing paid', () => {
    const f = computeJobFinancials(base);
    expect(f).toMatchObject({ paidKobo: 0n, balanceKobo: 5_000_000n, status: 'NOT_STARTED', readyToStart: false, overpaid: false });
  });

  it('deposit paid: part-paid and ready (AFTER_DEPOSIT)', () => {
    const f = computeJobFinancials({ ...base, payments: [kora(2_500_000n)] });
    expect(f).toMatchObject({ paidKobo: 2_500_000n, balanceKobo: 2_500_000n, status: 'PART_PAID', readyToStart: true });
  });

  it('deposit paid but rule is AFTER_FULL: not ready', () => {
    const f = computeJobFinancials({ ...base, readyRule: 'AFTER_FULL', payments: [kora(2_500_000n)] });
    expect(f.readyToStart).toBe(false);
  });

  it('fully paid', () => {
    const f = computeJobFinancials({ ...base, readyRule: 'AFTER_FULL', payments: [kora(2_500_000n), kora(2_500_000n)] });
    expect(f).toMatchObject({ balanceKobo: 0n, status: 'FULLY_PAID', readyToStart: true });
  });

  it('manual payments count towards paid but never towards ready', () => {
    const f = computeJobFinancials({ ...base, payments: [manual(5_000_000n)] });
    expect(f).toMatchObject({ paidKobo: 5_000_000n, verifiedPaidKobo: 0n, status: 'FULLY_PAID', readyToStart: false, hasUnverifiedPayments: true });
  });

  it('overpaid shows a negative balance', () => {
    const f = computeJobFinancials({ ...base, payments: [kora(2_500_000n), kora(3_000_000n)] });
    expect(f).toMatchObject({ balanceKobo: -500_000n, overpaid: true, status: 'FULLY_PAID' });
  });

  it('cancelled overrides status and readiness', () => {
    const f = computeJobFinancials({ ...base, cancelledAt: new Date(), payments: [kora(2_500_000n)] });
    expect(f).toMatchObject({ status: 'CANCELLED', readyToStart: false });
  });

  it('FULL plan with AFTER_DEPOSIT rule needs the full amount', () => {
    const job = { ...base, plan: 'FULL' as const, depositKobo: null };
    expect(readyThresholdKobo(job)).toBe(5_000_000n);
    expect(computeJobFinancials({ ...job, payments: [kora(4_999_999n)] }).readyToStart).toBe(false);
  });
});

describe('firstRequestFor', () => {
  it('FULL -> full amount', () => {
    expect(firstRequestFor({ plan: 'FULL', totalKobo: 100n, depositKobo: null })).toEqual({ kind: 'FULL', amountKobo: 100n });
  });
  it('DEPOSIT_BALANCE -> deposit', () => {
    expect(firstRequestFor({ plan: 'DEPOSIT_BALANCE', totalKobo: 100n, depositKobo: 40n })).toEqual({ kind: 'DEPOSIT', amountKobo: 40n });
  });
});

describe('validateJobAmounts', () => {
  it.each([
    [{ plan: 'FULL', totalKobo: 100n, depositKobo: null }, null],
    [{ plan: 'FULL', totalKobo: 0n, depositKobo: null }, 'totalKobo must be greater than zero'],
    [{ plan: 'FULL', totalKobo: 100n, depositKobo: 50n }, 'depositKobo is only allowed for a deposit-and-balance plan'],
    [{ plan: 'DEPOSIT_BALANCE', totalKobo: 100n, depositKobo: undefined }, 'depositKobo is required for a deposit-and-balance plan'],
    [{ plan: 'DEPOSIT_BALANCE', totalKobo: 100n, depositKobo: 100n }, 'depositKobo must be less than totalKobo'],
    [{ plan: 'DEPOSIT_BALANCE', totalKobo: 100n, depositKobo: 0n }, 'depositKobo must be greater than zero'],
    [{ plan: 'DEPOSIT_BALANCE', totalKobo: 100n, depositKobo: 40n }, null],
  ] as const)('%o -> %s', (input, expected) => {
    expect(validateJobAmounts(input)).toBe(expected);
  });
});
