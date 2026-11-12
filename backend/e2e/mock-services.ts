/**
 * Mock Kora + Telegram Bot API for end-to-end tests. It speaks the same HTTP shapes as the
 * real services, so the Worker's real clients, signature check and parsers are exercised.
 *
 * ⚠ Kora shapes follow Kora's public API docs (bank-transfer charge, charge query, webhook):
 *   POST {base}/charges/bank-transfer   -> { status, message, data: { reference, payment_reference, amount_expected, fee, vat, currency, narration, status: "processing", bank_account: {...}, customer } }
 *   GET  {base}/charges/:reference      -> { status, message, data: { reference, status, amount, amount_paid, fee, currency, payment_method, payer_bank_account, ... } }
 *   Webhook to notification_url         -> { event: "charge.success", data: { reference, currency, amount, fee, status, payment_method, payment_reference } }
 *                                          header x-korapay-signature = hex HMAC-SHA256(secret, JSON.stringify(data))
 *   Error envelope                      -> { status: false, message, data: null }
 *
 * Control endpoints (test-only) live under /__mock/*.
 */
import { createHmac, randomInt } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export interface MockOptions {
  port: number;
  koraSecretKey: string;
  telegramBotToken: string;
}

interface Charge {
  reference: string;
  paymentReference: string;
  amountExpected: number; // naira, as Kora reports it
  currency: 'NGN';
  narration: string;
  customer: { name: string; email: string };
  accountName: string;
  accountNumber: string;
  bankName: string;
  bankCode: string;
  expiresAt: Date;
  notificationUrl: string;
  status: 'processing' | 'success' | 'failed' | 'expired';
  amountPaid: number | null;
  fee: number;
  payer: { account_name: string; account_number: string; bank_name: string } | null;
  createdAt: Date;
}

export interface SentTelegramMessage {
  chat_id: string;
  text: string;
  reply_markup?: { inline_keyboard: { text: string; url: string }[][] };
}

export interface KoraRequestLog {
  method: string;
  path: string;
  auth: string | undefined;
  body: unknown;
}

export class MockServices {
  readonly charges = new Map<string, Charge>();
  readonly koraRequests: KoraRequestLog[] = [];
  readonly telegramMessages: SentTelegramMessage[] = [];
  readonly webhookDeliveries: { reference: string; status: number; body: string }[] = [];
  /** Next N create-charge calls fail with this HTTP status (simulates a Kora outage). */
  failCreates: { remaining: number; status: number } = { remaining: 0, status: 503 };
  /** Expiry Kora assigns to new accounts, in seconds from now (negative = already expired). */
  expirySeconds = 3600;
  /** Next N sendMessage calls fail with HTTP 500 (simulates a Telegram outage). */
  telegramFailures = 0;
  telegramAttempts = 0;
  private server = createServer((req, res) => this.route(req, res).catch((err) => this.send(res, 500, { error: String(err) })));
  private messageId = 1000;

  constructor(private readonly opts: MockOptions) {}

  listen(): Promise<void> {
    return new Promise((resolve) => this.server.listen(this.opts.port, '127.0.0.1', resolve));
  }
  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  // ---- control API used by the test runner (in-process) ----------------------------------

  /** Simulate the customer paying `amountNaira` into the account for `reference`, then deliver Kora's webhook. */
  async pay(reference: string, opts: { amountNaira?: number; payerName?: string; deliverWebhook?: boolean } = {}): Promise<number | null> {
    const c = this.charges.get(reference);
    if (!c) throw new Error(`mock: unknown reference ${reference}`);
    const amount = opts.amountNaira ?? c.amountExpected;
    c.status = 'success';
    c.amountPaid = amount;
    c.fee = Math.round(amount * 0.01 * 100) / 100 > 2000 ? 2000 : Math.round(amount * 0.01 * 100) / 100;
    c.payer = { account_name: opts.payerName ?? 'TOLU ADEYEMI', account_number: '0123456789', bank_name: 'Guaranty Trust Bank' };
    if (opts.deliverWebhook === false) return null;
    return this.deliverWebhook(reference);
  }

  /** Kora's webhook body for a charge, exactly as it would be signed and sent. */
  webhookPayload(reference: string, event = 'charge.success') {
    const c = this.charges.get(reference)!;
    return {
      event,
      data: {
        reference: c.reference,
        currency: c.currency,
        amount: c.amountPaid ?? c.amountExpected,
        fee: c.fee,
        status: c.status,
        payment_method: 'bank_transfer',
        payment_reference: c.paymentReference,
      },
    };
  }

  sign(payload: { data: unknown }): string {
    return createHmac('sha256', this.opts.koraSecretKey).update(JSON.stringify(payload.data)).digest('hex');
  }

  async deliverWebhook(reference: string, overrides: { signature?: string; event?: string } = {}): Promise<number> {
    const c = this.charges.get(reference)!;
    const payload = this.webhookPayload(reference, overrides.event);
    const res = await fetch(c.notificationUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-korapay-signature': overrides.signature ?? this.sign(payload) },
      body: JSON.stringify(payload),
    });
    const body = await res.text();
    this.webhookDeliveries.push({ reference, status: res.status, body });
    return res.status;
  }

  // ---- HTTP routing ---------------------------------------------------------------------

  private async route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://mock');
    const body = await readJson(req);

    // Kora API
    const kora = /^\/merchant\/api\/v1(\/.*)$/.exec(url.pathname);
    if (kora) {
      this.koraRequests.push({ method: req.method!, path: kora[1]!, auth: req.headers.authorization, body });
      if (req.headers.authorization !== `Bearer ${this.opts.koraSecretKey}`) {
        return this.send(res, 401, { status: false, message: 'Invalid authorization key', data: null });
      }
      if (req.method === 'POST' && kora[1] === '/charges/bank-transfer') return this.createCharge(res, body as Record<string, any>);
      const q = /^\/charges\/([^/]+)$/.exec(kora[1]!);
      if (req.method === 'GET' && q) return this.queryCharge(res, decodeURIComponent(q[1]!));
      return this.send(res, 404, { status: false, message: 'Route not found', data: null });
    }

    // Telegram Bot API
    const tg = /^\/bot([^/]+)\/(\w+)$/.exec(url.pathname);
    if (tg) {
      if (tg[1] !== this.opts.telegramBotToken) return this.send(res, 401, { ok: false, error_code: 401, description: 'Unauthorized' });
      if (tg[2] === 'sendMessage') {
        this.telegramAttempts++;
        if (this.telegramFailures > 0) {
          this.telegramFailures--;
          return this.send(res, 500, { ok: false, error_code: 500, description: 'Internal Server Error' });
        }
        const b = body as SentTelegramMessage;
        if (!b?.chat_id || !b.text) return this.send(res, 400, { ok: false, error_code: 400, description: 'Bad Request: message text is empty' });
        for (const row of b.reply_markup?.inline_keyboard ?? []) {
          for (const btn of row) {
            // The real Bot API rejects non-http(s) URLs in buttons.
            if (!/^https?:\/\//.test(btn.url)) return this.send(res, 400, { ok: false, error_code: 400, description: 'Bad Request: inline keyboard button URL is invalid' });
          }
        }
        this.telegramMessages.push(b);
        return this.send(res, 200, {
          ok: true,
          result: {
            message_id: this.messageId++,
            from: { id: 7000000001, is_bot: true, first_name: 'Kobo-Exact', username: 'KoboExactE2EBot' },
            chat: { id: Number(b.chat_id), type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: b.text,
          },
        });
      }
      return this.send(res, 200, { ok: true, result: true });
    }

    return this.send(res, 404, { error: 'mock: no route' });
  }

  private createCharge(res: ServerResponse, b: Record<string, any>) {
    if (this.failCreates.remaining > 0) {
      this.failCreates.remaining--;
      return this.send(res, this.failCreates.status, { status: false, message: 'Service temporarily unavailable', data: null });
    }
    const missing = ['reference', 'amount', 'currency', 'customer'].filter((k) => b?.[k] == null);
    if (missing.length || !b.customer?.email) {
      return this.send(res, 400, { status: false, message: `Invalid request data: ${[...missing, ...(b?.customer?.email ? [] : ['customer.email'])].join(', ')} required`, data: null });
    }
    if (typeof b.amount !== 'number' || b.amount < 100) {
      return this.send(res, 400, { status: false, message: 'amount must be a number of at least 100', data: null });
    }
    if (this.charges.has(b.reference)) {
      return this.send(res, 400, { status: false, message: 'Duplicate reference', data: null });
    }
    const expiresAt = new Date(Date.now() + this.expirySeconds * 1000);
    const c: Charge = {
      reference: b.reference,
      paymentReference: `KPY-PAY-${randomInt(1e9, 9e9)}`,
      amountExpected: b.amount,
      currency: 'NGN',
      narration: b.narration ?? '',
      customer: b.customer,
      accountName: b.account_name ?? 'Kora Merchant',
      accountNumber: String(randomInt(7_800_000_000, 7_899_999_999)),
      bankName: 'wema',
      bankCode: '035',
      expiresAt,
      notificationUrl: b.notification_url,
      status: 'processing',
      amountPaid: null,
      fee: 0,
      payer: null,
      createdAt: new Date(),
    };
    this.charges.set(c.reference, c);
    return this.send(res, 200, {
      status: true,
      message: 'Bank transfer initiated successfully',
      data: {
        currency: 'NGN',
        narration: c.narration,
        amount_expected: c.amountExpected,
        fee: 0,
        vat: 0,
        reference: c.reference,
        payment_reference: c.paymentReference,
        status: 'processing',
        bank_account: {
          account_name: c.accountName,
          account_number: c.accountNumber,
          bank_name: c.bankName,
          bank_code: c.bankCode,
          expiry_date_in_utc: c.expiresAt.toISOString(),
        },
        customer: c.customer,
      },
    });
  }

  private queryCharge(res: ServerResponse, reference: string) {
    const c = this.charges.get(reference);
    if (!c) return this.send(res, 404, { status: false, message: 'Charge not found', data: null });
    const status = c.status === 'processing' && c.expiresAt < new Date() ? 'expired' : c.status;
    return this.send(res, 200, {
      status: true,
      message: 'Charge retrieved successfully',
      data: {
        reference: c.reference,
        status,
        amount: (c.amountPaid ?? c.amountExpected).toFixed(2),
        amount_paid: c.amountPaid == null ? null : c.amountPaid.toFixed(2),
        amount_expected: c.amountExpected.toFixed(2),
        fee: c.fee.toFixed(2),
        currency: 'NGN',
        description: c.narration,
        payment_method: 'bank_transfer',
        payment_reference: c.paymentReference,
        transaction_reference: c.status === 'success' ? `KPY-TRX-${c.paymentReference.slice(-6)}` : null,
        payer_bank_account: c.payer,
        customer: c.customer,
        created_at: c.createdAt.toISOString(),
      },
    });
  }

  private send(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}
