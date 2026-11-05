import type { Kobo } from '../../domain/money';

export interface CreateAccountInput {
  reference: string;
  amountKobo: Kobo;
  customerName: string;
  /** Kora requires a customer email; we don't collect one, so a placeholder is used. ⚠ Confirm with Kora. */
  customerEmail: string;
  accountName: string;
  narration: string;
  notificationUrl: string;
}

export interface AllocatedAccount {
  reference: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  expiresAt: Date;
}

export type KoraChargeState = 'success' | 'pending' | 'failed' | 'expired' | 'unknown';

export interface KoraCharge {
  reference: string;
  state: KoraChargeState;
  rawStatus: string;
  /** What Kora actually accepted. This is the number that counts. */
  amountAcceptedKobo: Kobo | null;
  amountExpectedKobo: Kobo | null;
  feeKobo: Kobo | null;
  payerName: string | null;
  payerBank: string | null;
  payerAccountNumber: string | null;
  transactionReference: string | null;
  /** True when payer details are sandbox placeholders. */
  simulated: boolean;
}

export interface KoraClient {
  /** Allocate a single-use bank account. Must be safe to call twice with the same reference. */
  createSingleUseAccount(input: CreateAccountInput): Promise<AllocatedAccount>;
  /** Look a charge up by our reference. null = Kora has no charge with that reference. */
  queryCharge(reference: string): Promise<KoraCharge | null>;
}

export class KoraError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export class KoraDuplicateReferenceError extends KoraError {
  constructor(body?: unknown) {
    super('Kora reports this reference already exists', false, 400, body);
  }
}
