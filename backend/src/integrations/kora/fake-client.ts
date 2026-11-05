/**
 * A stand-in for Kora, used when KORA_MODE=fake. It lets the frontend team and the demo run
 * before Kora enables single-use accounts on our account.
 *
 * Fake accounts are deterministic (derived from the reference). Payments are simulated with
 * POST /api/dev/simulate-payment/:requestId, which records a payment through the same service
 * code the real verification path uses. queryCharge always reports "pending", so unpaid fake
 * requests expire normally.
 */
import type { AllocatedAccount, CreateAccountInput, KoraCharge, KoraClient } from './types';

export class FakeKoraClient implements KoraClient {
  constructor(
    private readonly expiryMinutes: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createSingleUseAccount(input: CreateAccountInput): Promise<AllocatedAccount> {
    let hash = 0;
    for (const ch of input.reference) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return {
      reference: input.reference,
      bankName: 'Fake Bank (sandbox)',
      accountNumber: `99${String(hash % 100_000_000).padStart(8, '0')}`,
      accountName: input.accountName,
      expiresAt: new Date(this.now().getTime() + this.expiryMinutes * 60_000),
    };
  }

  async queryCharge(reference: string): Promise<KoraCharge | null> {
    return {
      reference,
      state: 'pending',
      rawStatus: 'processing',
      amountAcceptedKobo: null,
      amountExpectedKobo: null,
      feeKobo: null,
      payerName: null,
      payerBank: null,
      payerAccountNumber: null,
      transactionReference: null,
      simulated: true,
    };
  }
}
