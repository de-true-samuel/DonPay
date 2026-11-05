/** Test harness: real Postgres, fake Kora/Telegram/queue, controllable clock. */
import 'dotenv/config';
import { afterAll, beforeEach } from 'vitest';
import type { AppConfig } from '../src/config';
import { createDb, type Db } from '../src/db/client';
import type { Deps } from '../src/deps';
import { createApp, CSRF_HEADER_VALUE } from '../src/http/app';
import { signKoraPayload } from '../src/integrations/kora/signature';
import type { AllocatedAccount, CreateAccountInput, KoraCharge, KoraClient } from '../src/integrations/kora/types';
import { KoraError } from '../src/integrations/kora/types';
import { ConsoleTelegramSender } from '../src/integrations/telegram/sender';
import { silentLogger } from '../src/log';
import { processBatch, type QueueMessageLike } from '../src/queue/consumer';
import type { QueueMessage } from '../src/queue/messages';

export const KORA_SECRET = 'sk_test_kobo_exact';

export const testConfig: AppConfig = {
  appEnv: 'test',
  publicBaseUrl: 'https://api.test',
  frontendUrl: 'https://app.test',
  frontendOrigins: ['https://app.test'],
  cookieSameSite: 'Lax',
  koraMode: 'sandbox',
  koraBaseUrl: 'https://kora.test',
  koraSecretKey: KORA_SECRET,
  koraExpiryMinutes: 60,
  placeholderEmailDomain: 'customers.test',
  devLoginEnabled: true,
  telegramBotToken: null,
  telegramBotUsername: 'KoboExactTestBot',
  telegramWebhookSecret: 'tg-secret',
  adminSecret: 'admin-secret',
};

/** Programmable Kora: allocates accounts, and lets tests decide what a charge query returns. */
export class TestKora implements KoraClient {
  readonly created: CreateAccountInput[] = [];
  readonly charges = new Map<string, KoraCharge>();
  readonly references = new Set<string>();
  failNextCreate: Error | null = null;
  failQuery: Error | null = null;
  constructor(private readonly clock: Clock) {}

  async createSingleUseAccount(input: CreateAccountInput): Promise<AllocatedAccount> {
    if (this.failNextCreate) {
      const e = this.failNextCreate;
      this.failNextCreate = null;
      throw e;
    }
    this.created.push(input);
    this.references.add(input.reference);
    return {
      reference: input.reference,
      bankName: 'Wema Bank',
      accountNumber: `78${String(this.created.length).padStart(8, '0')}`,
      accountName: input.accountName,
      expiresAt: new Date(this.clock.now().getTime() + 60 * 60_000),
    };
  }

  async queryCharge(reference: string): Promise<KoraCharge | null> {
    if (this.failQuery) throw this.failQuery;
    return this.charges.get(reference) ?? (this.references.has(reference) ? pending(reference) : null);
  }

  /** Make Kora report a successful payment for this reference. */
  pay(reference: string, amountKobo: bigint, extra: Partial<KoraCharge> = {}) {
    this.charges.set(reference, {
      reference,
      state: 'success',
      rawStatus: 'success',
      amountAcceptedKobo: amountKobo,
      amountExpectedKobo: amountKobo,
      feeKobo: 0n,
      payerName: 'TOLU ADEYEMI',
      payerBank: 'GTBank',
      payerAccountNumber: '0123456789',
      transactionReference: `KPY-${reference}`,
      simulated: false,
      ...extra,
    });
  }
}

const pending = (reference: string): KoraCharge => ({
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
  simulated: false,
});

export class Clock {
  constructor(public current = new Date('2026-11-05T10:00:00.000Z')) {}
  now = () => new Date(this.current.getTime());
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export interface TestHarness {
  db: Db;
  deps: Deps;
  kora: TestKora;
  telegram: ConsoleTelegramSender;
  queue: QueueMessage[];
  clock: Clock;
  /** Process queued messages until the queue is empty (or `max` rounds). */
  drain(max?: number): Promise<{ retried: QueueMessage[] }>;
  app: ReturnType<typeof createApp>;
  api(method: string, path: string, opts?: { body?: unknown; token?: string; headers?: Record<string, string> }): Promise<Response>;
  login(businessName?: string): Promise<{ token: string; providerId: string }>;
}

let sharedDb: Db | null = null;

export function setupHarness(): TestHarness {
  if (!sharedDb) sharedDb = createDb(process.env.TEST_DATABASE_URL!);
  const db = sharedDb;
  const clock = new Clock();
  const kora = new TestKora(clock);
  const telegram = new ConsoleTelegramSender();
  const queue: QueueMessage[] = [];
  const deps: Deps = {
    db,
    kora,
    telegram,
    queue: { send: async (m) => void queue.push(m) },
    config: { ...testConfig },
    now: clock.now,
    log: silentLogger,
  };
  // Silence the console sender.
  telegram.sendMessage = async function (chatId, text, buttons) {
    this.sent.push({ chatId: chatId.toString(), text, buttons });
  };

  const app = createApp({ makeDeps: () => ({ ...deps, log: silentLogger }) });

  const h: TestHarness = {
    db,
    deps,
    kora,
    telegram,
    queue,
    clock,
    app,
    async drain(max = 20) {
      const retried: QueueMessage[] = [];
      for (let round = 0; round < max && queue.length; round++) {
        const batch = queue.splice(0, queue.length);
        const msgs: QueueMessageLike[] = batch.map((body, i) => ({
          id: `m${round}-${i}`,
          body,
          attempts: 1,
          ack() {},
          retry() {
            retried.push(body);
          },
        }));
        await processBatch(deps, msgs);
      }
      return { retried };
    },
    async api(method, path, opts = {}) {
      const headers: Record<string, string> = { ...(opts.headers ?? {}) };
      if (method !== 'GET') headers['X-Requested-With'] ??= CSRF_HEADER_VALUE;
      if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
      if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
      return app.request(path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    },
    async login(businessName = `Tolu's Glam Studio ${Math.random().toString(36).slice(2, 7)}`) {
      const res = await h.api('POST', '/api/auth/dev-login', { body: { businessName } });
      const json = (await res.json()) as { sessionToken: string; provider: { id: string } };
      return { token: json.sessionToken, providerId: json.provider.id };
    },
  };

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      'TRUNCATE "Provider", "Customer", "Job", "PaymentRequest", "Payment", "WebhookEvent", "ReviewItem", "Notification", "Session", "LoginToken" CASCADE',
    );
    queue.length = 0;
    telegram.sent.length = 0;
    kora.created.length = 0;
    kora.charges.clear();
    kora.references.clear();
    kora.failNextCreate = null;
    kora.failQuery = null;
    clock.current = new Date('2026-11-05T10:00:00.000Z');
    deps.config = { ...testConfig };
  });

  afterAll(async () => {
    await sharedDb?.$disconnect();
    sharedDb = null;
  });

  return h;
}

export async function json<T = any>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Expected JSON, got ${res.status}: ${text.slice(0, 300)}`);
  }
}

export async function signedWebhook(payload: unknown): Promise<{ body: string; signature: string }> {
  return { body: JSON.stringify(payload), signature: await signKoraPayload(KORA_SECRET, payload) };
}

export const retryableKoraError = () => new KoraError('Kora 503', true, 503);

/** Create a deposit-and-balance job for "Tolu" via the API and return the created detail. */
export async function createDepositJob(h: TestHarness, token: string, overrides: Record<string, unknown> = {}) {
  const res = await h.api('POST', '/api/jobs', {
    token,
    body: {
      customer: { name: 'Tolu Adeyemi', phone: '0803 123 4567' },
      service: 'Bridal makeup',
      totalKobo: '5000000',
      plan: 'DEPOSIT_BALANCE',
      depositKobo: '2500000',
      balanceDueAt: '2026-11-06T09:00:00.000Z',
      readyRule: 'AFTER_DEPOSIT',
      ...overrides,
    },
  });
  if (res.status !== 201) throw new Error(`createDepositJob failed: ${res.status} ${await res.text()}`);
  return json(res);
}
