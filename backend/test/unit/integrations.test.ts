import { describe, expect, it } from 'vitest';
import { paidAlert, paymentRequestMessage, receiptMessage } from '../../src/domain/messages';
import { KoraHttpClient, mapKoraStatus } from '../../src/integrations/kora/http-client';
import { signKoraPayload, verifyKoraSignature } from '../../src/integrations/kora/signature';
import { KoraDuplicateReferenceError, KoraError } from '../../src/integrations/kora/types';

describe('Kora webhook signature', () => {
  const payload = { event: 'charge.success', data: { reference: 'KE-abc-1', amount: 25000, status: 'success' } };
  it('accepts a correct signature and rejects tampering', async () => {
    const sig = await signKoraPayload('secret', payload);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyKoraSignature('secret', payload, sig)).toBe(true);
    expect(await verifyKoraSignature('secret', payload, sig.toUpperCase())).toBe(true);
    expect(await verifyKoraSignature('other', payload, sig)).toBe(false);
    expect(await verifyKoraSignature('secret', { ...payload, data: { ...payload.data, amount: 1 } }, sig)).toBe(false);
    expect(await verifyKoraSignature('secret', payload, null)).toBe(false);
  });
});

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    const { status, body } = handler(String(url), init);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
}

const clientWith = (fetchImpl: typeof fetch) =>
  new KoraHttpClient({ baseUrl: 'https://kora.test/v1', secretKey: 'sk', defaultExpiryMinutes: 30, sandbox: true, fetchImpl, now: () => new Date('2026-11-05T10:00:00Z') });

const createInput = {
  reference: 'KE-abc-1',
  amountKobo: 2500050n,
  customerName: 'Tolu',
  customerEmail: 'x@y.z',
  accountName: "Tolu's Glam",
  narration: 'Bridal makeup',
  notificationUrl: 'https://api.test/webhooks/kora',
};

describe('KoraHttpClient', () => {
  it('creates an account, sending naira and auth', async () => {
    let sent: any;
    const client = clientWith(
      fakeFetch((url, init) => {
        sent = { url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).Authorization };
        return {
          status: 200,
          body: {
            status: true,
            data: {
              reference: 'KE-abc-1',
              bank_account: { account_name: "Tolu's Glam", account_number: '7821234567', bank_name: 'Wema Bank', expiry_date_in_utc: '2026-11-05T11:00:00Z' },
            },
          },
        };
      }),
    );
    const acct = await client.createSingleUseAccount(createInput);
    expect(sent.url).toBe('https://kora.test/v1/charges/bank-transfer');
    expect(sent.auth).toBe('Bearer sk');
    expect(sent.body.amount).toBe(25000.5);
    expect(sent.body.currency).toBe('NGN');
    expect(acct).toEqual({ reference: 'KE-abc-1', bankName: 'Wema Bank', accountNumber: '7821234567', accountName: "Tolu's Glam", expiresAt: new Date('2026-11-05T11:00:00Z') });
  });

  it('falls back to the configured expiry when Kora omits it', async () => {
    const client = clientWith(
      fakeFetch(() => ({
        status: 200,
        body: { status: true, data: { reference: 'r', bank_account: { account_name: 'a', account_number: '1', bank_name: 'b' } } },
      })),
    );
    expect((await client.createSingleUseAccount(createInput)).expiresAt.toISOString()).toBe('2026-11-05T10:30:00.000Z');
  });

  it('maps errors: duplicate, retryable, non-retryable', async () => {
    await expect(clientWith(fakeFetch(() => ({ status: 400, body: { status: false, message: 'Duplicate reference' } }))).createSingleUseAccount(createInput)).rejects.toBeInstanceOf(
      KoraDuplicateReferenceError,
    );
    const e503 = await clientWith(fakeFetch(() => ({ status: 503, body: {} }))).createSingleUseAccount(createInput).catch((e) => e);
    expect(e503).toBeInstanceOf(KoraError);
    expect(e503.retryable).toBe(true);
    const e401 = await clientWith(fakeFetch(() => ({ status: 401, body: {} }))).createSingleUseAccount(createInput).catch((e) => e);
    expect(e401.retryable).toBe(false);
  });

  it('queries a successful charge and uses the accepted amount', async () => {
    const client = clientWith(
      fakeFetch((url) => {
        expect(url).toBe('https://kora.test/v1/charges/KE-abc-1');
        return {
          status: 200,
          body: {
            status: true,
            data: {
              reference: 'KE-abc-1',
              status: 'success',
              amount: 25000,
              amount_paid: '25000.00',
              fee: 100,
              payer_bank_account: { account_name: 'TOLU ADEYEMI', account_number: '0123456789', bank_name: 'GTBank' },
            },
          },
        };
      }),
    );
    const c = await client.queryCharge('KE-abc-1');
    expect(c).toMatchObject({ state: 'success', amountAcceptedKobo: 2500000n, feeKobo: 10000n, payerName: 'TOLU ADEYEMI', simulated: true });
  });

  it('pending charge has no accepted amount; 404 is null', async () => {
    const pending = await clientWith(fakeFetch(() => ({ status: 200, body: { status: true, data: { reference: 'r', status: 'processing', amount: 100 } } }))).queryCharge('r');
    expect(pending).toMatchObject({ state: 'pending', amountAcceptedKobo: null });
    expect(await clientWith(fakeFetch(() => ({ status: 404, body: {} }))).queryCharge('r')).toBeNull();
  });

  it('status mapping', () => {
    expect(mapKoraStatus('SUCCESS')).toBe('success');
    expect(mapKoraStatus('processing')).toBe('pending');
    expect(mapKoraStatus('reversed')).toBe('failed');
    expect(mapKoraStatus('weird')).toBe('unknown');
  });
});

describe('messages', () => {
  const now = new Date('2026-11-05T10:00:00.000Z'); // Thursday
  it('payment request message has every detail and share links', () => {
    const m = paymentRequestMessage({
      businessName: "Tolu's Glam Studio",
      customerName: 'Tolu Adeyemi',
      customerPhone: '+2348031234567',
      service: 'Bridal makeup',
      kind: 'DEPOSIT',
      amountKobo: 2500000n,
      bankName: 'Wema Bank',
      accountNumber: '7821234567',
      accountName: "Tolu's Glam Studio",
      expiresAt: new Date('2026-11-05T14:45:00.000Z'),
      payLink: 'https://api.test/p/abc',
    });
    expect(m.text).toContain('Hi Tolu,');
    expect(m.text).toContain('Amount: ₦25,000.00 (pay this exact amount)');
    expect(m.text).toContain('Account number: 7821234567');
    expect(m.text).toContain('Valid until: 3:45 PM, Thu 5 Nov');
    expect(m.whatsappUrl.startsWith('https://wa.me/2348031234567?text=')).toBe(true);
    expect(decodeURIComponent(m.whatsappUrl.split('text=')[1]!)).toBe(m.text);
    expect(m.telegramUrl).toContain(encodeURIComponent('https://api.test/p/abc'));
  });

  it('paid alert matches the product description', () => {
    const text = paidAlert({
      customerName: 'Tolu Adeyemi',
      service: 'Bridal makeup',
      kind: 'DEPOSIT',
      amountKobo: 2500000n,
      balanceKobo: 2500000n,
      balanceDueAt: new Date('2026-11-06T09:00:00.000Z'),
      readyToStart: true,
      becameReady: true,
      payerName: null,
      payerSimulated: false,
      flags: [],
      now,
    });
    expect(text.split('\n')[0]).toBe('Paid ✔ ₦25,000 from Tolu for Bridal makeup. Deposit received. Ready to start ✔');
    expect(text).toContain('Balance ₦25,000 due tomorrow.');
    expect(text).toContain('Payer name: unknown');
  });

  it('receipt mentions the remaining balance or full payment', () => {
    const args = {
      businessName: 'B',
      customerName: 'Tolu',
      customerPhone: '+2348031234567',
      service: 'S',
      kind: 'DEPOSIT' as const,
      amountKobo: 100n,
      balanceDueAt: null,
      paidAt: now,
      payLink: 'https://x/p/y',
      now,
    };
    expect(receiptMessage({ ...args, balanceKobo: 500n }).text).toContain('Balance remaining: ₦5.00.');
    expect(receiptMessage({ ...args, balanceKobo: 0n }).text).toContain('fully paid');
  });
});
