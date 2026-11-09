/**
 * Kora (Korapay) HTTP client.
 *
 * ⚠ Confirm: endpoint paths and response field names follow Kora's public docs at the time of
 * writing (bank-transfer charge + charge query). Every field Kora sends is parsed in this file
 * only, so if Kora's shapes differ, nothing else changes.
 */
import { z } from 'zod';
import { koboToNairaNumber, nairaToKobo } from '../../domain/money';
import {
  KoraDuplicateReferenceError,
  KoraError,
  type AllocatedAccount,
  type CreateAccountInput,
  type KoraCharge,
  type KoraChargeState,
  type KoraClient,
} from './types';

const amount = z.union([z.number(), z.string()]).nullish();

const envelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ status: z.boolean(), message: z.string().optional(), data: data.optional() });

const createResponse = envelope(
  z
    .object({
      reference: z.string(),
      bank_account: z
        .object({
          account_name: z.string(),
          account_number: z.string(),
          bank_name: z.string(),
          expiry_date_in_utc: z.string().nullish(),
        })
        .loose(),
    })
    .loose(),
);

const payerAccount = z
  .object({
    account_name: z.string().nullish(),
    account_number: z.string().nullish(),
    bank_name: z.string().nullish(),
  })
  .loose()
  .nullish();

const chargeData = z
  .object({
    reference: z.string(),
    status: z.string(),
    amount,
    amount_paid: amount,
    amount_expected: amount,
    fee: amount,
    transaction_reference: z.string().nullish(),
    payment_reference: z.string().nullish(),
    payer_bank_account: payerAccount,
    bank_account: payerAccount,
  })
  .loose();

const queryResponse = envelope(chargeData);

export interface KoraHttpConfig {
  baseUrl: string;
  secretKey: string;
  defaultExpiryMinutes: number;
  sandbox: boolean;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export class KoraHttpClient implements KoraClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly cfg: KoraHttpConfig) {
    this.fetchImpl = cfg.fetchImpl ?? ((...args) => fetch(...args));
    this.now = cfg.now ?? (() => new Date());
  }

  async createSingleUseAccount(input: CreateAccountInput): Promise<AllocatedAccount> {
    const body = {
      reference: input.reference,
      amount: koboToNairaNumber(input.amountKobo),
      currency: 'NGN',
      account_name: input.accountName,
      narration: input.narration,
      notification_url: input.notificationUrl,
      merchant_bears_cost: true,
      customer: { name: input.customerName, email: input.customerEmail },
    };
    const res = await this.request('POST', '/charges/bank-transfer', body);
    if (!res.ok) {
      const text = JSON.stringify(res.json ?? {});
      if (res.status === 400 && /duplicate|already exist/i.test(text)) throw new KoraDuplicateReferenceError(res.json);
      throw new KoraError(`Kora create account failed (${res.status})`, res.status >= 500 || res.status === 429, res.status, res.json);
    }
    const parsed = createResponse.safeParse(res.json);
    if (!parsed.success || !parsed.data.status || !parsed.data.data) {
      throw new KoraError('Unexpected Kora create-account response', false, res.status, res.json);
    }
    const d = parsed.data.data;
    let expiresAt = d.bank_account.expiry_date_in_utc ? new Date(d.bank_account.expiry_date_in_utc) : null;
    if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
      expiresAt = new Date(this.now().getTime() + this.cfg.defaultExpiryMinutes * 60_000);
    }
    return {
      reference: d.reference,
      bankName: d.bank_account.bank_name,
      accountNumber: d.bank_account.account_number,
      accountName: d.bank_account.account_name,
      expiresAt,
    };
  }

  async queryCharge(reference: string): Promise<KoraCharge | null> {
    const res = await this.request('GET', `/charges/${encodeURIComponent(reference)}`);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new KoraError(`Kora charge query failed (${res.status})`, res.status >= 500 || res.status === 429, res.status, res.json);
    }
    const parsed = queryResponse.safeParse(res.json);
    if (!parsed.success || !parsed.data.data) {
      if (parsed.success && parsed.data.status === false) return null;
      throw new KoraError('Unexpected Kora charge-query response', true, res.status, res.json);
    }
    return toCharge(parsed.data.data, this.cfg.sandbox);
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: unknown }> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.cfg.secretKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new KoraError(`Kora network error: ${(err as Error).message}`, true);
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON error body */
    }
    return { ok: res.ok, status: res.status, json };
  }
}

export function mapKoraStatus(status: string): KoraChargeState {
  const s = status.toLowerCase();
  if (s === 'success' || s === 'successful' || s === 'completed') return 'success';
  if (s === 'processing' || s === 'pending' || s === 'initiated') return 'pending';
  if (s === 'failed' || s === 'reversed' || s === 'declined') return 'failed';
  if (s === 'expired') return 'expired';
  return 'unknown';
}

function toKobo(v: number | string | null | undefined): bigint | null {
  if (v == null || v === '') return null;
  try {
    return nairaToKobo(v);
  } catch {
    return null;
  }
}

export function toCharge(d: z.infer<typeof chargeData>, sandbox: boolean): KoraCharge {
  const payer = d.payer_bank_account ?? null;
  const state = mapKoraStatus(d.status);
  // For bank transfers Kora reports the amount it accepted; `amount_paid` when present, else `amount`.
  const accepted = state === 'success' ? (toKobo(d.amount_paid) ?? toKobo(d.amount)) : toKobo(d.amount_paid);
  return {
    reference: d.reference,
    state,
    rawStatus: d.status,
    amountAcceptedKobo: accepted,
    amountExpectedKobo: toKobo(d.amount_expected) ?? toKobo(d.amount),
    feeKobo: toKobo(d.fee),
    payerName: payer?.account_name?.trim() || null,
    payerBank: payer?.bank_name?.trim() || null,
    payerAccountNumber: payer?.account_number?.trim() || null,
    transactionReference: d.transaction_reference ?? d.payment_reference ?? null,
    simulated: sandbox,
  };
}
