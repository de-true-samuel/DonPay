/**
 * End-to-end test of the running Worker (wrangler dev / workerd), with Kora and Telegram replaced
 * by mock servers that speak their real HTTP formats (e2e/mock-services.ts).
 *
 *   npm run test:e2e
 *
 * Nothing is faked inside the Worker: KORA_MODE=live, so the real Kora HTTP client, webhook
 * signature check, queue consumer, cron sweep and Telegram sender all run. Every response is
 * validated against contract.md (e2e/contract-schemas.ts).
 */
import 'dotenv/config';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import type { z } from 'zod';
import * as S from './contract-schemas';
import { MockServices } from './mock-services';

const WORKER_PORT = 8792;
const MOCK_PORT = 8791;
const WORKER = `http://127.0.0.1:${WORKER_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const FRONTEND_ORIGIN = 'http://localhost:5173';
const KORA_SECRET = 'sk_test_e2e_kobo_exact';
const TG_TOKEN = '7000000001:AAE2E-test-token';
const TG_SECRET = 'e2e-telegram-secret';
const ADMIN_SECRET = 'e2e-admin';
const DB_URL = process.env.E2E_DATABASE_URL ?? 'postgresql://kobo:kobo@localhost:54329/kobo_exact_e2e';
const CHAT_A = 5550001;
const CHAT_B = 5550002;

// ---------------------------------------------------------------- tiny test framework
type Result = { section: string; name: string; ok: boolean; ms: number; detail?: string };
const results: Result[] = [];
let section = '';
const sectionOf = (s: string) => {
  section = s;
  console.log(`\n▸ ${s}`);
};
async function check(name: string, fn: () => Promise<void>) {
  const t = Date.now();
  try {
    await fn();
    results.push({ section, name, ok: true, ms: Date.now() - t });
    console.log(`  ✔ ${name}`);
  } catch (e) {
    const detail = (e as Error).message.slice(0, 1500);
    results.push({ section, name, ok: false, ms: Date.now() - t, detail });
    console.log(`  ✘ ${name}\n      ${detail.split('\n').join('\n      ')}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function eq<T>(actual: T, expected: T, what: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function conforms<T extends z.ZodType>(schema: T, data: unknown, label: string): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issues = r.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`${label} does not match contract.md:\n${issues.join('\n')}\nbody: ${JSON.stringify(data).slice(0, 400)}`);
  }
  return r.data;
}
async function eventually<T>(fn: () => Promise<T>, what: string, timeoutMs = 30_000): Promise<T> {
  const start = Date.now();
  let last: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      return await fn();
    } catch (e) {
      last = e;
    }
    await sleep(400);
  }
  throw new Error(`timed out after ${timeoutMs / 1000}s waiting for ${what}: ${(last as Error)?.message}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- HTTP client (behaves like the browser app)
interface Res {
  status: number;
  headers: Headers;
  body: any;
  text: string;
}
class Client {
  cookie: string | null = null;
  bearer: string | null = null;
  async req(method: string, path: string, body?: unknown, opts: { csrf?: boolean; headers?: Record<string, string> } = {}): Promise<Res> {
    const headers: Record<string, string> = { Origin: FRONTEND_ORIGIN, ...(opts.headers ?? {}) };
    if (method !== 'GET' && opts.csrf !== false) headers['X-Requested-With'] = 'kobo-exact';
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.cookie) headers.Cookie = this.cookie;
    if (this.bearer) headers.Authorization = `Bearer ${this.bearer}`;
    const res = await fetch(`${WORKER}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie?.startsWith('ke_session=')) this.cookie = setCookie.split(';')[0]!;
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* html / csv */
    }
    return { status: res.status, headers: res.headers, body: parsed, text };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b?: unknown, o?: { csrf?: boolean }) => this.req('POST', p, b ?? {}, o);
  patch = (p: string, b: unknown) => this.req('PATCH', p, b);
}
function expectStatus(r: Res, status: number, what: string) {
  if (r.status !== status) throw new Error(`${what}: expected HTTP ${status}, got ${r.status}: ${r.text.slice(0, 400)}`);
}
function expectError(r: Res, status: number, code: string) {
  expectStatus(r, status, code);
  const e = conforms(S.ApiError, r.body, 'error body');
  eq(e.error.code, code, 'error.code');
}
const telegramUpdate = (chatId: number, text: string, firstName = 'Tolu') => ({
  update_id: Math.floor(Math.random() * 1e9),
  message: {
    message_id: Math.floor(Math.random() * 1e6),
    from: { id: chatId, is_bot: false, first_name: firstName, username: `${firstName.toLowerCase()}_e2e`, language_code: 'en' },
    chat: { id: chatId, first_name: firstName, username: `${firstName.toLowerCase()}_e2e`, type: 'private' },
    date: Math.floor(Date.now() / 1000),
    text,
    entities: text.startsWith('/') ? [{ offset: 0, length: text.split(' ')[0]!.length, type: 'bot_command' }] : undefined,
  },
});
const sendTelegram = (update: unknown, secret: string | null = TG_SECRET) =>
  fetch(`${WORKER}/webhooks/telegram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {}) },
    body: JSON.stringify(update),
  });
const runCron = async () => {
  const r = await fetch(`${WORKER}/__scheduled?cron=*+*+*+*+*`);
  assert(r.ok, `cron trigger failed: ${r.status}`);
};

// ---------------------------------------------------------------- infrastructure
async function prepareDatabase() {
  const admin = new pg.Client({ connectionString: DB_URL.replace(/\/[^/]+$/, '/kobo_exact') });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', ['kobo_exact_e2e']);
  if (!exists.rowCount) await admin.query('CREATE DATABASE kobo_exact_e2e');
  await admin.end();
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: DB_URL }, stdio: 'pipe' });
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  await db.query(
    'TRUNCATE "Provider", "Customer", "Job", "PaymentRequest", "Payment", "WebhookEvent", "ReviewItem", "Notification", "Session", "LoginToken" CASCADE',
  );
  return db;
}

function startWorker(): ChildProcess {
  const vars: Record<string, string> = {
    APP_ENV: 'e2e',
    PUBLIC_BASE_URL: WORKER,
    FRONTEND_URL: FRONTEND_ORIGIN,
    FRONTEND_ORIGINS: FRONTEND_ORIGIN,
    COOKIE_SAMESITE: 'Lax',
    KORA_MODE: 'live',
    KORA_BASE_URL: `${MOCK}/merchant/api/v1`,
    KORA_SECRET_KEY: KORA_SECRET,
    KORA_EXPIRY_MINUTES: '60',
    DEV_LOGIN_ENABLED: 'true',
    TELEGRAM_BOT_USERNAME: 'KoboExactE2EBot',
    TELEGRAM_BOT_TOKEN: TG_TOKEN,
    TELEGRAM_API_BASE: MOCK,
    TELEGRAM_WEBHOOK_SECRET: TG_SECRET,
    ADMIN_SECRET,
  };
  const args = ['npx', 'wrangler', 'dev', '--port', String(WORKER_PORT), '--ip', '127.0.0.1', '--test-scheduled', '--persist-to', '.wrangler/e2e-state'];
  for (const [k, v] of Object.entries(vars)) args.push('--var', `"${k}:${v}"`);
  const child = spawn(args.join(' '), {
    shell: true,
    env: { ...process.env, CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: DB_URL, WRANGLER_SEND_METRICS: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log: string[] = [];
  const keep = (b: Buffer) => {
    for (const line of b.toString().split('\n')) if (line.trim()) log.push(line);
    if (log.length > 400) log.splice(0, log.length - 400);
  };
  child.stdout!.on('data', keep);
  child.stderr!.on('data', keep);
  (child as any).log = log;
  return child;
}

function stopWorker(child: ChildProcess) {
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
    } catch {
      /* already gone */
    }
  } else child.kill('SIGTERM');
}

// ---------------------------------------------------------------- the scenarios
async function main() {
  console.log('Preparing database kobo_exact_e2e …');
  const db = await prepareDatabase();
  const mock = new MockServices({ port: MOCK_PORT, koraSecretKey: KORA_SECRET, telegramBotToken: TG_TOKEN });
  await mock.listen();
  console.log(`Mock Kora + Telegram on ${MOCK}. Starting Worker (wrangler dev, KORA_MODE=live → mock) …`);
  const worker = startWorker();
  const started = Date.now();
  try {
    await eventually(async () => {
      const r = await fetch(`${WORKER}/health`);
      assert(r.ok, `health ${r.status}`);
    }, 'the Worker to start', 120_000);
    console.log(`Worker ready in ${((Date.now() - started) / 1000).toFixed(1)}s`);

    const a = new Client(); // provider A: browser-style, cookie session
    const b = new Client(); // provider B: bearer token
    const chatA = () => mock.telegramMessages.filter((m) => m.chat_id === String(CHAT_A));
    const koraRef = async (requestId: string) =>
      (await db.query('SELECT "koraReference" FROM "PaymentRequest" WHERE id = $1', [requestId])).rows[0]?.koraReference as string;

    // ================================================================ 1
    sectionOf('1. Health, CORS');
    await check('GET /health matches contract and reports the DB up', async () => {
      const r = await a.get('/health');
      expectStatus(r, 200, 'health');
      eq(conforms(S.Health, r.body, 'health').db, true, 'db');
    });
    await check('CORS preflight allows the frontend origin with credentials, refuses others', async () => {
      const ok = await fetch(`${WORKER}/api/today`, { method: 'OPTIONS', headers: { Origin: FRONTEND_ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-requested-with' } });
      eq(ok.headers.get('access-control-allow-origin'), FRONTEND_ORIGIN, 'allow-origin');
      eq(ok.headers.get('access-control-allow-credentials'), 'true', 'allow-credentials');
      const bad = await fetch(`${WORKER}/api/today`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
      eq(bad.headers.get('access-control-allow-origin'), null, 'evil origin');
    });

    // ================================================================ 2
    sectionOf('2. Login through the Telegram bot');
    let loginToken = '';
    await check('Telegram webhook rejects updates without the secret token', async () => {
      eq((await sendTelegram(telegramUpdate(CHAT_A, '/start'), null)).status, 401, 'status');
    });
    await check('/start creates the provider and the bot replies with a login button', async () => {
      eq((await sendTelegram(telegramUpdate(CHAT_A, '/start'))).status, 200, 'status');
      const msg = await eventually(async () => {
        const m = chatA().find((x) => x.text.includes('Welcome to Paidar'));
        assert(m, 'no welcome message yet');
        return m;
      }, 'welcome message');
      const btn = msg.reply_markup?.inline_keyboard?.[0]?.[0];
      assert(btn && btn.url.startsWith(`${FRONTEND_ORIGIN}/auth?t=`), `login button url: ${btn?.url}`);
      loginToken = decodeURIComponent(btn.url.split('t=')[1]!);
    });
    await check('POST /api/auth/exchange returns a session and sets an HttpOnly cookie', async () => {
      const r = await a.post('/api/auth/exchange', { token: loginToken });
      expectStatus(r, 200, 'exchange');
      const auth = conforms(S.AuthResponse, r.body, 'AuthResponse');
      eq(auth.provider.telegramLinked, true, 'telegramLinked');
      const cookie = r.headers.get('set-cookie') ?? '';
      assert(/HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie), `cookie flags: ${cookie}`);
      assert(a.cookie, 'cookie captured');
    });
    await check('the same login link cannot be used twice', async () => {
      expectError(await new Client().post('/api/auth/exchange', { token: loginToken }), 401, 'UNAUTHENTICATED');
    });
    await check('GET /api/me works with the cookie alone; 401 without it', async () => {
      conforms(S.Provider, (await a.get('/api/me')).body, 'Provider');
      expectError(await new Client().get('/api/me'), 401, 'UNAUTHENTICATED');
    });
    await check('PATCH /api/me updates business name, ready rule, digest time', async () => {
      const r = await a.patch('/api/me', { businessName: "Tolu's Glam Studio", defaultReadyRule: 'AFTER_DEPOSIT', digestTime: '19:30' });
      const p = conforms(S.Provider, r.body, 'Provider');
      eq([p.businessName, p.digestTime], ["Tolu's Glam Studio", '19:30'], 'provider');
    });
    await check('changes without X-Requested-With are refused (CSRF)', async () => {
      expectError(await a.post('/api/customers', { name: 'X', phone: '08030000000' }, { csrf: false }), 403, 'CSRF_HEADER_MISSING');
    });

    // ================================================================ 3
    sectionOf('3. Customers');
    let customerId = '';
    await check('create a customer (phone normalised to E.164)', async () => {
      const r = await a.post('/api/customers', { name: 'Tolu Adeyemi', phone: '0803 123 4567', messageConsent: true });
      expectStatus(r, 201, 'create');
      const c = conforms(S.Customer, r.body, 'Customer');
      eq(c.phone, '+2348031234567', 'phone');
      customerId = c.id;
    });
    await check('duplicate phone → 409 CONFLICT with existingId', async () => {
      const r = await a.post('/api/customers', { name: 'Someone', phone: '+234 803 123 4567' });
      expectError(r, 409, 'CONFLICT');
      eq((r.body.error.details as any).existingId, customerId, 'existingId');
    });
    await check('CSV import creates, skips duplicates, reports bad lines', async () => {
      const csv = 'name,phone,consent\nChinedu Okafor,08099998888,yes\nAisha Musa,0803 333 4444,no\nDup,08031234567,\nNo Phone,,\n';
      const r = await a.post('/api/customers/import', { csv });
      const res = conforms(S.ImportResult, r.body, 'ImportResult');
      eq([res.created, res.skipped, res.errors.length], [2, 1, 1], 'created/skipped/errors');
    });
    await check('GET /api/customers?q= searches by name and phone', async () => {
      const byName = conforms(S.page(S.CustomerSummary), (await a.get('/api/customers?q=chinedu')).body, 'Page<CustomerSummary>');
      eq(byName.items.length, 1, 'by name');
      const byPhone = conforms(S.page(S.CustomerSummary), (await a.get('/api/customers?q=0803333')).body, 'Page<CustomerSummary>');
      eq(byPhone.items[0]?.name, 'Aisha Musa', 'by phone');
    });

    // ================================================================ 4
    sectionOf('4. Job → send (real Kora client → mock Kora)');
    const tomorrow = new Date(Date.now() + 24 * 3600_000).toISOString();
    let job1 = '';
    let req1 = '';
    let account1 = '';
    let payLink1 = '';
    await check('validation errors use the contract shape (nested fields included)', async () => {
      const r = await a.post('/api/jobs', { customer: { name: 'X', phone: '123' }, service: '', totalKobo: '25000.50', plan: 'DEPOSIT_BALANCE' });
      expectError(r, 400, 'VALIDATION_ERROR');
      const fields = Object.keys((r.body.error.details as any).fieldErrors);
      for (const f of ['service', 'totalKobo', 'customer.phone']) assert(fields.includes(f), `missing fieldError ${f} in ${fields}`);
      const r2 = await a.post('/api/jobs', { customerId, service: 'Gele', totalKobo: '100000', plan: 'DEPOSIT_BALANCE', depositKobo: '100000' });
      expectError(r2, 400, 'VALIDATION_ERROR');
    });
    await check('create a ₦50,000 job with a ₦25,000 deposit → DRAFT deposit request', async () => {
      const r = await a.post('/api/jobs', { customerId, service: 'Bridal makeup', totalKobo: '5000000', plan: 'DEPOSIT_BALANCE', depositKobo: '2500000', balanceDueAt: tomorrow, notes: 'Trial Thursday' });
      expectStatus(r, 201, 'create job');
      const j = conforms(S.JobDetail, r.body, 'JobDetail');
      eq([j.status, j.balanceKobo, j.readyToStart, j.requests.length, j.requests[0]?.kind, j.requests[0]?.status], ['NOT_STARTED', '5000000', false, 1, 'DEPOSIT', 'DRAFT'], 'job');
      job1 = j.id;
      req1 = j.requests[0]!.id;
    });
    await check('send → Kora receives the right charge request; response has account + prepared message', async () => {
      const before = mock.koraRequests.length;
      const r = await a.post(`/api/requests/${req1}/send`);
      expectStatus(r, 200, 'send');
      const rw = conforms(S.RequestWithMessage, r.body, 'RequestWithMessage');
      const call = mock.koraRequests.slice(before).find((k) => k.path === '/charges/bank-transfer');
      assert(call, 'Kora create-charge not called');
      const body = call.body as any;
      eq(call.auth, `Bearer ${KORA_SECRET}`, 'Kora auth header');
      eq([body.amount, body.currency, body.reference, body.notification_url], [25000, 'NGN', `KE-${req1}-1`, `${WORKER}/webhooks/kora`], 'Kora body');
      assert(typeof body.customer?.email === 'string' && body.customer.name === 'Tolu Adeyemi', 'Kora customer');
      eq(body.account_name, "Tolu's Glam Studio", 'account_name');
      const charge = mock.charges.get(body.reference)!;
      eq([rw.request.status, rw.request.accountNumber, rw.request.bankName], ['SENT', charge.accountNumber, 'wema'], 'request');
      eq(rw.message!.text.split('\n').slice(0, 2), ["Tolu's Glam Studio", 'Pay ₦25,000 for Bridal makeup (deposit)'], 'short template');
      eq([rw.message!.details?.accountNumber, rw.message!.details?.amountPlain, rw.message!.details?.amountKobo], [charge.accountNumber, '25000.00', 2500000], 'details');
      assert(rw.message!.text.includes(charge.accountNumber), 'message account');
      assert(rw.message!.whatsappUrl.startsWith('https://wa.me/2348031234567?text='), 'whatsapp target');
      account1 = charge.accountNumber;
      payLink1 = rw.request.payLink;
    });
    await check('sending again is idempotent (no second Kora account)', async () => {
      const creates = mock.koraRequests.filter((k) => k.path === '/charges/bank-transfer').length;
      const r = await a.post(`/api/requests/${req1}/send`);
      eq(r.body.request.accountNumber, account1, 'same account');
      eq(mock.koraRequests.filter((k) => k.path === '/charges/bank-transfer').length, creates, 'Kora create count');
    });
    await check('a second open request on the job is refused (OPEN_REQUEST_EXISTS)', async () => {
      expectError(await a.post(`/api/jobs/${job1}/requests/balance`, {}), 409, 'OPEN_REQUEST_EXISTS');
    });
    await check('public pay page: JSON has the account and no phone numbers; HTML renders', async () => {
      const token = payLink1.split('/p/')[1]!;
      const pub = conforms(S.PublicRequest, (await a.get(`/api/public/requests/${token}`)).body, 'PublicRequest');
      eq([pub.status, pub.accountNumber, pub.customerFirstName], ['SENT', account1, 'Tolu'], 'public');
      eq(conforms(S.PublicStatus, (await a.get(`/p/${token}/status`)).body, 'PublicStatus').state, 'waiting', 'status');
      assert(!JSON.stringify(pub).includes('803123'), 'phone leaked on public page');
      const html = await fetch(payLink1);
      eq(html.status, 200, 'html status');
      const page = await html.text();
      assert(page.includes('Tolu&#39;s Glam Studio') && page.includes(account1), 'html content');
      assert(html.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"), 'CSP');
      assert(page.length < 30 * 1024, `page is ${page.length} bytes`);
    });
    await check('Today → Waiting shows the sent request', async () => {
      const t = conforms(S.TodayResponse, (await a.get('/api/today')).body, 'TodayResponse');
      assert(t.waiting.some((w) => w.request.id === req1), 'not in waiting');
    });

    // ================================================================ 5
    sectionOf('5. Customer pays → Kora webhook → verify → PAID → Telegram alert');
    let ref1 = '';
    await check('mock Kora delivers a signed charge.success webhook; Worker returns 200 fast', async () => {
      ref1 = await koraRef(req1);
      const t = Date.now();
      const status = await mock.pay(ref1, { payerName: 'ADEYEMI TOLULOPE' });
      eq(status, 200, 'webhook status');
      assert(Date.now() - t < 3000, `webhook took ${Date.now() - t}ms`);
    });
    await check('queue consumer queries Kora and records the payment (deposit paid, ready to start)', async () => {
      const j = await eventually(async () => {
        const d = conforms(S.JobDetail, (await a.get(`/api/jobs/${job1}`)).body, 'JobDetail');
        assert(d.status === 'PART_PAID', `status ${d.status}`);
        return d;
      }, 'job to become PART_PAID');
      eq([j.paidKobo, j.verifiedPaidKobo, j.balanceKobo, j.readyToStart, j.openRequest], ['2500000', '2500000', '2500000', true, null], 'money');
      const p = j.payments[0]!;
      eq([p.source, p.amountKobo, p.payerName, p.payerAccountMasked, p.payerDetailsSimulated], ['KORA_VERIFIED', '2500000', 'ADEYEMI TOLULOPE', '******6789', false], 'payment');
      assert(mock.koraRequests.some((k) => k.method === 'GET' && k.path === `/charges/${ref1}`), 'Worker never queried Kora');
      eq(j.openReviewItems.length, 0, 'no review items');
    });
    await check('provider gets the Telegram alert with a WhatsApp receipt button', async () => {
      const alert = await eventually(async () => {
        const m = chatA().find((x) => x.text.startsWith('Paid ✔'));
        assert(m, 'no alert yet');
        return m;
      }, 'paid alert');
      eq(alert.text.split('\n')[0], 'Paid ✔ ₦25,000 from Tolu for Bridal makeup. Deposit received. Ready to start ✔', 'alert line');
      assert(alert.text.includes('Balance ₦25,000 due tomorrow.'), `balance line: ${alert.text}`);
      assert(alert.reply_markup!.inline_keyboard[0]![0]!.url.startsWith('https://wa.me/2348031234567?text='), 'receipt button');
    });
    await check('pay page becomes the receipt; account details hidden', async () => {
      const pub = conforms(S.PublicRequest, (await a.get(`/api/public/requests/${payLink1.split('/p/')[1]}`)).body, 'PublicRequest');
      eq([pub.status, pub.accountNumber, pub.receipt?.amountKobo, pub.receipt?.jobBalanceKobo], ['PAID', null, '2500000', '2500000'], 'receipt');
      const st = conforms(S.PublicStatus, (await a.get(`/p/${payLink1.split('/p/')[1]}/status`)).body, 'PublicStatus');
      eq([st.state, st.receipt?.amountKobo, st.receipt?.reference], ['paid', 2500000, pub.receipt?.reference], 'status receipt');
      assert((await (await fetch(payLink1)).text()).includes('Payment received'), 'receipt page');
    });
    await check('replayed webhook → {duplicate:true}, no second payment, no second alert', async () => {
      const alerts = chatA().filter((x) => x.text.startsWith('Paid ✔')).length;
      eq(await mock.deliverWebhook(ref1), 200, 'status');
      eq(JSON.parse(mock.webhookDeliveries.at(-1)!.body), { ok: true, duplicate: true }, 'body');
      await sleep(3000);
      eq((await db.query('SELECT count(*)::int AS n FROM "Payment" WHERE "requestId" = $1', [req1])).rows[0].n, 1, 'payments');
      eq(chatA().filter((x) => x.text.startsWith('Paid ✔')).length, alerts, 'alerts');
    });
    await check('forged webhook (bad signature) → 401 and nothing changes', async () => {
      eq(await mock.deliverWebhook(ref1, { signature: 'a'.repeat(64), event: 'charge.failed' }), 401, 'status');
    });
    await check('payment for an unknown reference → unattributed review item (visible to admin)', async () => {
      mock.charges.set('KE-stranger-1', { ...mock.charges.get(ref1)!, reference: 'KE-stranger-1', status: 'processing', amountPaid: null });
      eq(await mock.pay('KE-stranger-1', { amountNaira: 7000 }), 200, 'status');
      await eventually(async () => {
        const h = conforms(S.AdminHealth, (await a.req('GET', '/api/admin/health', undefined, { headers: { 'X-Admin-Secret': ADMIN_SECRET } })).body, 'AdminHealth');
        assert(h.unattributedReviewItems >= 1, `unattributed=${h.unattributedReviewItems}`);
      }, 'UNMATCHED_REFERENCE review');
    });

    // ================================================================ 6
    sectionOf('6. Balance: exact request, underpayment, then fully paid');
    let balReq = '';
    await check('balance request is computed by the backend (₦25,000) and sent', async () => {
      const r = await a.post(`/api/jobs/${job1}/requests/balance`, { send: true });
      expectStatus(r, 201, 'balance');
      const rw = conforms(S.RequestWithMessage, r.body, 'RequestWithMessage');
      eq([rw.request.kind, rw.request.amountKobo, rw.request.status], ['BALANCE', '2500000', 'SENT'], 'balance request');
      assert(rw.message!.text.includes('(balance)'), 'message says balance');
      balReq = rw.request.id;
    });
    await check('customer underpays (₦20,000): recorded at the amount Kora accepted, flagged AMOUNT_MISMATCH', async () => {
      await mock.pay(await koraRef(balReq), { amountNaira: 20000, payerName: 'TOLU ADEYEMI' });
      const j = await eventually(async () => {
        const d = conforms(S.JobDetail, (await a.get(`/api/jobs/${job1}`)).body, 'JobDetail');
        assert(d.paidKobo === '4500000', `paid ${d.paidKobo}`);
        return d;
      }, 'underpayment to be recorded');
      eq([j.balanceKobo, j.status], ['500000', 'PART_PAID'], 'balance');
      assert(j.openReviewItems.some((r) => r.kind === 'AMOUNT_MISMATCH' && r.message === 'Kora accepted ₦20,000.00 but the request was for ₦25,000.00.'), 'AMOUNT_MISMATCH');
    });
    await check('second balance request is exactly the remaining ₦5,000; paying it → FULLY_PAID', async () => {
      const r = await a.post(`/api/jobs/${job1}/requests/balance`, { send: true });
      eq(r.body.request?.amountKobo, '500000', 'amount');
      await mock.pay(await koraRef(r.body.request.id));
      await eventually(async () => {
        const d = conforms(S.JobDetail, (await a.get(`/api/jobs/${job1}`)).body, 'JobDetail');
        eq([d.status, d.balanceKobo], ['FULLY_PAID', '0'], 'job');
      }, 'FULLY_PAID');
    });
    await check('no more balance requests once fully paid (NOTHING_OWED)', async () => {
      expectError(await a.post(`/api/jobs/${job1}/requests/balance`, {}), 409, 'NOTHING_OWED');
    });
    await check('receipt message for a payment says the job is fully paid', async () => {
      const d = (await a.get(`/api/jobs/${job1}`)).body;
      const m = conforms(S.PreparedMessage, (await a.get(`/api/payments/${d.payments[0].id}/receipt-message`)).body, 'PreparedMessage');
      assert(m.text.includes('This job is now fully paid.'), m.text);
    });

    // ================================================================ 7
    sectionOf('7. Expiry, "send again", and a late payment on the old account');
    let job2 = '';
    let oldReq = '';
    let newReq = '';
    await check('request whose Kora account has expired shows as expired on the pay page', async () => {
      const r = await a.post('/api/jobs', { customer: { name: 'Chinedu Okafor', phone: '08099998888' }, service: 'Agbada makeup', totalKobo: '3000000', plan: 'FULL' });
      job2 = r.body.id;
      oldReq = r.body.requests[0].id;
      mock.expirySeconds = -300; // Kora hands back an account that expired 5 minutes ago
      const sent = await a.post(`/api/requests/${oldReq}/send`);
      mock.expirySeconds = 3600;
      expectStatus(sent, 200, 'send');
      const pub = conforms(S.PublicRequest, (await a.get(`/api/public/requests/${sent.body.request.payLink.split('/p/')[1]}`)).body, 'PublicRequest');
      eq([pub.status, pub.accountNumber], ['EXPIRED', null], 'public');
      eq(conforms(S.PublicStatus, (await a.get(`/p/${sent.body.request.payLink.split('/p/')[1]}/status`)).body, 'PublicStatus').state, 'expired', 'state');
    });
    await check('cron sweep → expiry check asks Kora → request EXPIRED; Today lists it under "send again"', async () => {
      await runCron();
      await eventually(async () => {
        const d = (await a.get(`/api/jobs/${job2}`)).body;
        eq(d.requests[0].status, 'EXPIRED', 'status');
      }, 'request to expire');
      const t = conforms(S.TodayResponse, (await a.get('/api/today')).body, 'TodayResponse');
      assert(t.expired.some((e) => e.request.id === oldReq), 'not in Today.expired');
    });
    await check('resend creates a NEW request with a NEW Kora account', async () => {
      const r = await a.post(`/api/requests/${oldReq}/resend`);
      const rw = conforms(S.RequestWithMessage, r.body, 'RequestWithMessage');
      assert(rw.request.id !== oldReq, 'same request id');
      eq([rw.request.status, rw.request.amountKobo], ['SENT', '3000000'], 'new request');
      assert(rw.request.accountNumber !== mock.charges.get(await koraRef(oldReq))!.accountNumber, 'account reused');
      newReq = rw.request.id;
    });
    await check('customer pays the OLD account anyway → recorded, flagged PAID_AFTER_EXPIRY', async () => {
      await mock.pay(await koraRef(oldReq), { payerName: 'OKAFOR CHINEDU' });
      const d = await eventually(async () => {
        const j = conforms(S.JobDetail, (await a.get(`/api/jobs/${job2}`)).body, 'JobDetail');
        assert(j.openReviewItems.some((r) => r.kind === 'PAID_AFTER_EXPIRY'), 'no review yet');
        return j;
      }, 'PAID_AFTER_EXPIRY');
      eq(d.requests.find((r) => r.id === oldReq)?.status, 'PAID', 'old request');
      eq(d.status, 'FULLY_PAID', 'job');
    });
    await check('resolving the review can cancel the now-unneeded replacement in one call', async () => {
      const d = (await a.get(`/api/jobs/${job2}`)).body;
      const item = d.openReviewItems.find((r: any) => r.kind === 'PAID_AFTER_EXPIRY');
      const r = await a.post(`/api/review/${item.id}/resolve`, { resolution: 'Paid the old account', cancelRequestId: newReq });
      const ri = conforms(S.ReviewItem, r.body, 'ReviewItem');
      assert(ri.resolvedAt, 'not resolved');
      eq((await a.get(`/api/jobs/${job2}`)).body.requests.find((x: any) => x.id === newReq).status, 'CANCELLED', 'replacement');
    });

    // ================================================================ 8
    sectionOf('8. Payer-name check, Kora outage, manual cash');
    await check('payer name that looks different → PAYER_NAME_DIFFERS and a ⚠ in the alert', async () => {
      const r = await a.post('/api/jobs', { customer: { name: 'Aisha Musa', phone: '08033334444' }, service: 'Makeup class', totalKobo: '2500000', plan: 'FULL' });
      const sent = await a.post(`/api/requests/${r.body.requests[0].id}/send`);
      await mock.pay(await koraRef(sent.body.request.id), { payerName: 'IBRAHIM YUSUF' });
      await eventually(async () => {
        const j = (await a.get(`/api/jobs/${r.body.id}`)).body;
        assert(j.openReviewItems.some((x: any) => x.kind === 'PAYER_NAME_DIFFERS'), 'no review');
      }, 'PAYER_NAME_DIFFERS');
      await eventually(async () => {
        assert(chatA().some((m) => m.text.includes('for Makeup class') && m.text.includes('⚠ Payer name looks different')), 'no ⚠ alert');
      }, 'alert with warning');
    });
    await check('Kora outage on send → 502 KORA_UNAVAILABLE, request stays DRAFT, retry succeeds', async () => {
      const r = await a.post('/api/jobs', { customerId, service: 'Touch-up', totalKobo: '500000', plan: 'FULL' });
      const reqId = r.body.requests[0].id;
      mock.failCreates = { remaining: 1, status: 503 };
      expectError(await a.post(`/api/requests/${reqId}/send`), 502, 'KORA_UNAVAILABLE');
      eq((await a.get(`/api/jobs/${r.body.id}`)).body.requests[0].status, 'DRAFT', 'status');
      expectStatus(await a.post(`/api/requests/${reqId}/send`), 200, 'retry');
    });
    await check('Telegram outage: the paid alert fails, the queue retries it, and it arrives once', async () => {
      const r = await a.post('/api/jobs', { customerId, service: 'Retry glam', totalKobo: '600000', plan: 'FULL' });
      const sent = await a.post(`/api/requests/${r.body.requests[0].id}/send`);
      const attemptsBefore = mock.telegramAttempts;
      mock.telegramFailures = 1;
      await mock.pay(await koraRef(sent.body.request.id), { payerName: 'TOLU ADEYEMI' });
      await eventually(async () => assert(chatA().some((m) => m.text.includes('for Retry glam')), 'alert not delivered yet'), 'retried alert', 60_000);
      assert(mock.telegramAttempts - attemptsBefore >= 2, `expected a failed attempt then a retry, saw ${mock.telegramAttempts - attemptsBefore}`);
      eq(chatA().filter((m) => m.text.includes('for Retry glam')).length, 1, 'delivered once');
    });
    await check('manual cash entry counts towards paid but never towards Ready to start', async () => {
      const r = await a.post('/api/jobs', { customerId, service: 'Lashes', totalKobo: '1800000', plan: 'DEPOSIT_BALANCE', depositKobo: '800000' });
      const p = await a.post(`/api/jobs/${r.body.id}/payments/manual`, { amountKobo: '800000', note: 'Cash at studio' });
      expectStatus(p, 201, 'manual');
      eq(conforms(S.Payment, p.body, 'Payment').source, 'MANUAL', 'source');
      const j = conforms(S.JobDetail, (await a.get(`/api/jobs/${r.body.id}`)).body, 'JobDetail');
      eq([j.paidKobo, j.verifiedPaidKobo, j.readyToStart, j.hasUnverifiedPayments], ['800000', '0', false, true], 'job');
    });

    // ================================================================ 9
    sectionOf('9. Scheduled sends, balance-due prompts, daily digest (cron → queue → Telegram)');
    await check('scheduled request: prompt arrives at the time; no Kora account until Send', async () => {
      const r = await a.post('/api/jobs', { customerId, service: 'Party glam', totalKobo: '1200000', plan: 'FULL' });
      const reqId = r.body.requests[0].id;
      const creates = mock.koraRequests.filter((k) => k.path === '/charges/bank-transfer').length;
      const s = await a.post(`/api/requests/${reqId}/schedule`, { scheduledFor: new Date(Date.now() + 2500).toISOString() });
      eq(conforms(S.RequestWithMessage, s.body, 'RequestWithMessage').request.status, 'SCHEDULED', 'status');
      await sleep(3000);
      await runCron();
      const prompt = await eventually(async () => {
        const m = chatA().find((x) => x.text.startsWith("Time to send Tolu's full payment request"));
        assert(m, 'no prompt');
        return m;
      }, 'scheduled prompt');
      eq(prompt.reply_markup!.inline_keyboard[0]![0]!.url, `${FRONTEND_ORIGIN}/jobs/${r.body.id}`, 'reminder links to the job page');
      eq(mock.koraRequests.filter((k) => k.path === '/charges/bank-transfer').length, creates, 'Kora not called');
      const t = conforms(S.TodayResponse, (await a.get('/api/today')).body, 'TodayResponse');
      assert(t.dueReminders.some((x) => x.request.id === reqId), 'not in Today.dueReminders');
      expectError(await a.post(`/api/requests/${reqId}/schedule`, { scheduledFor: new Date(Date.now() - 60_000).toISOString() }), 400, 'VALIDATION_ERROR');
    });
    await check('balance due today → one prompt even across two sweeps', async () => {
      const due = new Date(Date.now() + 60_000).toISOString();
      const r = await a.post('/api/jobs', { customer: { name: 'Kemi Ogunleye', phone: '08187776655' }, service: 'Owambe glam', totalKobo: '9000000', plan: 'DEPOSIT_BALANCE', depositKobo: '4500000', balanceDueAt: due });
      const sent = await a.post(`/api/requests/${r.body.requests[0].id}/send`);
      await mock.pay(await koraRef(sent.body.request.id), { payerName: 'OGUNLEYE KEMI' });
      await eventually(async () => eq((await a.get(`/api/jobs/${r.body.id}`)).body.status, 'PART_PAID', 'status'), 'deposit');
      await runCron();
      await runCron();
      await eventually(async () => assert(chatA().some((m) => m.text.startsWith('Balance due today: ₦45,000 from Kemi')), 'no prompt'), 'balance prompt');
      await sleep(2000);
      eq(chatA().filter((m) => m.text.startsWith('Balance due today: ₦45,000 from Kemi')).length, 1, 'prompt count');
      const t = conforms(S.TodayResponse, (await a.get('/api/today')).body, 'TodayResponse');
      assert(t.balancesDue.some((j) => j.id === r.body.id), 'not in Today.balancesDue');
    });
    await check('daily digest is sent once per day', async () => {
      await a.patch('/api/me', { digestTime: '00:00' });
      await runCron();
      await runCron();
      await eventually(async () => assert(chatA().some((m) => m.text.startsWith("📋 Today at Tolu's Glam Studio")), 'no digest'), 'digest');
      await sleep(2000);
      eq(chatA().filter((m) => m.text.startsWith('📋 Today at')).length, 1, 'digest count');
    });

    // ================================================================ 10
    sectionOf('10. Today, search, history, export');
    await check('Today view matches the contract and counts line up', async () => {
      const t = conforms(S.TodayResponse, (await a.get('/api/today')).body, 'TodayResponse');
      eq(
        t.counts,
        { dueReminders: t.dueReminders.length, justPaid: t.justPaid.length, waiting: t.waiting.length, balancesDue: t.balancesDue.length, expired: t.expired.length, needsReview: t.needsReview.length },
        'counts',
      );
      assert(t.justPaid.length >= 5, `justPaid=${t.justPaid.length}`);
      assert(t.needsReview.length >= 2, `needsReview=${t.needsReview.length}`);
    });
    await check('search: name, "25k", phone fragment, filter chips, saved view, pagination', async () => {
      const q = async (s: string) => conforms(S.SearchResponse, (await a.get(`/api/search?${s}`)).body, 'SearchResponse');
      assert((await q('q=bridal')).items.some((j) => j.id === job1), 'name/service');
      const amt = await q('q=25k');
      eq(amt.interpreted.amountKobo, '2500000', 'interpreted');
      assert(amt.items.some((j) => j.id === job1), 'amount');
      eq((await q('q=0809999')).items.map((j) => j.customer.name), ['Chinedu Okafor'], 'phone');
      assert((await q('status=paid')).items.length >= 4, 'chip paid');
      assert((await q('view=needs_follow_up')).items.length >= 1, 'view');
      const p1 = await q('limit=2');
      assert(p1.nextCursor, 'cursor');
      const p2 = await q(`limit=2&cursor=${p1.nextCursor}`);
      assert(p2.items.every((j) => !p1.items.some((x) => x.id === j.id)), 'pages overlap');
      expectError(await a.get('/api/search?status=bogus'), 400, 'VALIDATION_ERROR');
    });
    await check('customer page: jobs + newest-first timeline', async () => {
      const c = conforms(S.CustomerPage, (await a.get(`/api/customers/${customerId}`)).body, 'CustomerPage');
      assert(c.jobs.length >= 4, `jobs=${c.jobs.length}`);
      const types = new Set(c.timeline.map((e) => e.type));
      for (const t of ['JOB_CREATED', 'REQUEST_SENT', 'PAYMENT_RECEIVED', 'MANUAL_PAYMENT']) assert(types.has(t as any), `timeline missing ${t}`);
      const sorted = [...c.timeline].sort((x, y) => (x.at < y.at ? 1 : -1));
      eq(c.timeline.map((e) => e.at), sorted.map((e) => e.at), 'timeline order');
    });
    await check('job list with status filter + pagination', async () => {
      const fully = conforms(S.page(S.JobSummary), (await a.get('/api/jobs?status=FULLY_PAID')).body, 'Page<JobSummary>');
      assert(fully.items.every((j) => j.status === 'FULLY_PAID') && fully.items.length >= 2, 'filter');
    });
    await check('review list (open) matches the contract', async () => {
      const r = conforms(S.page(S.ReviewItem), (await a.get('/api/review')).body, 'Page<ReviewItem>');
      assert(r.items.length >= 2 && r.items.every((i) => i.resolvedAt === null), 'open items');
    });
    await check('CSV export: one row per payment, accountant-friendly columns', async () => {
      const r = await a.get('/api/export.csv');
      assert(r.headers.get('content-type')?.includes('text/csv'), 'content-type');
      const lines = r.text.trim().split('\r\n');
      eq(lines[0], 'date,customer,phone,service,request_kind,amount_naira,source,payer_name,kora_reference,job_total_naira,job_balance_naira', 'header');
      const n = (await db.query('SELECT count(*)::int AS n FROM "Payment" p JOIN "Provider" v ON v.id = p."providerId" WHERE v."telegramChatId" = $1', [CHAT_A])).rows[0].n;
      eq(lines.length - 1, n, 'rows');
      assert(lines.some((l) => l.includes('manual (not verified by Kora)')), 'manual label');
    });

    // ================================================================ 11
    sectionOf('11. Second provider: isolation, Telegram linking, bot commands');
    await check('dev login works (bearer token) when enabled', async () => {
      const r = await b.post('/api/auth/dev-login', { businessName: 'Ada Tailoring' });
      b.bearer = conforms(S.AuthResponse, r.body, 'AuthResponse').sessionToken;
      b.cookie = null;
    });
    await check("provider B gets 404 on everything of provider A's", async () => {
      for (const [m, p] of [
        ['GET', `/api/jobs/${job1}`],
        ['POST', `/api/jobs/${job1}/cancel`],
        ['POST', `/api/requests/${req1}/send`],
        ['GET', `/api/customers/${customerId}`],
        ['GET', `/api/requests/${req1}/message`],
      ] as const) {
        expectError(await b.req(m, p, m === 'POST' ? {} : undefined), 404, 'NOT_FOUND');
      }
      eq(conforms(S.SearchResponse, (await b.get('/api/search?q=tolu')).body, 'SearchResponse').items.length, 0, 'search');
      eq(conforms(S.TodayResponse, (await b.get('/api/today')).body, 'TodayResponse').counts.justPaid, 0, 'today');
    });
    await check('"Connect Telegram" deep link links B\'s chat', async () => {
      const link = conforms(S.TelegramLink, (await b.post('/api/me/telegram-link')).body, 'TelegramLink');
      await sendTelegram(telegramUpdate(CHAT_B, `/start ${link.url.split('start=')[1]}`, 'Ada'));
      await eventually(async () => eq(conforms(S.Provider, (await b.get('/api/me')).body, 'Provider').telegramLinked, true, 'linked'), 'link');
      await eventually(async () => assert(mock.telegramMessages.some((m) => m.chat_id === String(CHAT_B) && m.text.startsWith('Connected ✔')), 'no confirmation'), 'confirmation');
    });
    await check('/today and /help bot commands reply', async () => {
      await sendTelegram(telegramUpdate(CHAT_A, '/today'));
      await eventually(async () => assert(chatA().some((m) => m.text.startsWith('✔ Paid today:')), 'no /today reply'), '/today');
      await sendTelegram(telegramUpdate(CHAT_A, '/help'));
      await eventually(async () => assert(chatA().some((m) => m.text.startsWith('Paidar commands:')), 'no /help reply'), '/help');
    });

    // ================================================================ 12
    sectionOf('12. Cancel, admin, logout, final consistency');
    await check('cancelling a job cancels its open request; balance requests then refused', async () => {
      const r = await a.post('/api/jobs', { customerId, service: 'Cancelled gig', totalKobo: '700000', plan: 'FULL' });
      await a.post(`/api/requests/${r.body.requests[0].id}/send`);
      const c = conforms(S.JobDetail, (await a.post(`/api/jobs/${r.body.id}/cancel`)).body, 'JobDetail');
      eq([c.status, c.requests[0]!.status], ['CANCELLED', 'CANCELLED'], 'cancelled');
      expectError(await a.post(`/api/jobs/${r.body.id}/requests/balance`, {}), 409, 'INVALID_STATE');
    });
    // ================================================================ 12
    sectionOf('12. Contract 1.1.0: idempotency, claim + recheck, nudge, start, copied, account, support');
    const idem = (key: string) => ({ headers: { 'Idempotency-Key': key } });
    let job12 = '';
    let req12 = '';
    let token12 = '';
    await check('Idempotency-Key: create job twice → one job; send twice → one Kora account, replayed', async () => {
      const body = { customer: { name: 'Halima Bello', phone: '08061112222', messageLanguage: 'pcm' }, service: 'Henna', totalKobo: '1500000', plan: 'FULL' };
      const j1 = await a.req('POST', '/api/jobs', body, idem('e2e-job-1'));
      const j2 = await a.req('POST', '/api/jobs', body, idem('e2e-job-1'));
      expectStatus(j1, 201, 'create');
      eq([j2.status, j2.headers.get('idempotent-replayed'), j2.body.id], [201, 'true', j1.body.id], 'replay');
      job12 = j1.body.id;
      req12 = j1.body.requests[0].id;
      const creates = mock.koraRequests.filter((k) => k.path === '/charges/bank-transfer').length;
      const s1 = await a.req('POST', `/api/requests/${req12}/send`, {}, idem('e2e-send-1'));
      const s2 = await a.req('POST', `/api/requests/${req12}/send`, {}, idem('e2e-send-1'));
      const rw = conforms(S.RequestWithMessage, s1.body, 'RequestWithMessage');
      eq(s2.body, s1.body, 'same body');
      eq(mock.koraRequests.filter((k) => k.path === '/charges/bank-transfer').length, creates + 1, 'one Kora account');
      eq(rw.message!.language, 'pcm', 'Pidgin customer');
      assert(rw.message!.text.includes('Abeg pay ₦15,000 for Henna'), rw.message!.text);
      token12 = rw.request.payLink.split('/p/')[1]!;
      const other = await a.req('POST', '/api/jobs', { ...body, service: 'Different' }, idem('e2e-job-1'));
      expectError(other, 422, 'IDEMPOTENCY_KEY_REUSED');
    });
    await check('copied marker, nudge message and start-message guard', async () => {
      const c1 = conforms(S.PaymentRequest, (await a.post(`/api/requests/${req12}/copied`)).body, 'PaymentRequest');
      const c2 = conforms(S.PaymentRequest, (await a.post(`/api/requests/${req12}/copied`)).body, 'PaymentRequest');
      assert(c1.detailsCopiedAt && c1.detailsCopiedAt === c2.detailsCopiedAt, 'detailsCopiedAt set once');
      const n = conforms(S.PreparedMessage, (await a.get(`/api/requests/${req12}/nudge-message`)).body, 'PreparedMessage');
      assert(/go expire in (59|60) minutes|1 hour/.test(n.text), n.text);
      expectError(await a.get(`/api/jobs/${job12}/start-message`), 409, 'JOB_NOT_READY');
    });
    await check('"I\'ve paid": status unchanged, provider alerted, queued recheck finds the payment whose webhook was lost', async () => {
      const ref = await koraRef(req12);
      await mock.pay(ref, { payerName: 'BELLO HALIMA', deliverWebhook: false }); // Kora has the money; no webhook is sent
      const claimRes = await fetch(`${WORKER}/p/${token12}/claim-paid`, { method: 'POST', headers: { 'X-Requested-With': 'kobo-exact' } });
      eq(claimRes.status, 202, 'claim status');
      conforms(S.ClaimResult, await claimRes.json(), 'ClaimResult');
      await eventually(async () => assert(chatA().some((m) => m.text.startsWith('Halima says they have paid ₦15,000')), 'no claim alert'), 'claim alert');
      await eventually(async () => eq((await a.get(`/api/jobs/${job12}`)).body.status, 'FULLY_PAID', 'status'), 'recheck to record the payment');
      const rw = conforms(S.RequestWithMessage, (await a.post(`/api/requests/${req12}/recheck`)).body, 'RequestWithMessage');
      eq([rw.request.status, rw.job.paidKobo], ['PAID', '1500000'], 'idempotent recheck');
      assert(rw.request.customerClaimedPaidAt, 'customerClaimedPaidAt');
      const start = conforms(S.PreparedMessage, (await a.get(`/api/jobs/${job12}/start-message`)).body, 'PreparedMessage');
      assert(start.text.startsWith('Hi Halima, we don receive your payment for Henna'), start.text);
    });
    await check('background reconciliation records a lost-webhook payment without any claim', async () => {
      const r = await a.post('/api/jobs', { customer: { name: 'Ifeoma Eze', phone: '08062223333' }, service: 'Nails', totalKobo: '800000', plan: 'FULL' });
      const reqId = r.body.requests[0].id;
      await a.post(`/api/requests/${reqId}/send`);
      await db.query(`UPDATE "PaymentRequest" SET "sentAt" = now() - interval '5 minutes' WHERE id = $1`, [reqId]);
      await mock.pay(await koraRef(reqId), { payerName: 'EZE IFEOMA', deliverWebhook: false });
      await runCron();
      await eventually(async () => eq((await a.get(`/api/jobs/${r.body.id}`)).body.status, 'FULLY_PAID', 'status'), 'reconciliation');
    });
    await check('PATCH /api/me phone + onboardedAt; export; support lookup by reference', async () => {
      const me = conforms(S.Provider, (await a.patch('/api/me', { phone: '0803 555 0000', onboardedAt: new Date().toISOString() })).body, 'Provider');
      eq(me.phone, '+2348035550000', 'phone');
      const exp = conforms(S.AccountExport, (await a.get('/api/me/export')).body, 'AccountExport');
      assert(exp.jobs.some((j) => j.id === job12), 'export has the job');
      const ref = await koraRef(req12);
      expectError(await a.get(`/api/admin/support/requests/${ref}`), 403, 'FORBIDDEN');
      const sv = conforms(S.SupportRequestView, (await a.req('GET', `/api/admin/support/requests/${ref}`, undefined, { headers: { 'X-Admin-Secret': ADMIN_SECRET } })).body, 'SupportRequestView');
      eq([sv.request.id, sv.request.status, sv.claims.length], [req12, 'PAID', 1], 'support view');
    });

    sectionOf('13. Operations');
    await check('admin health: needs the secret; no stuck webhooks or unsent alerts', async () => {
      expectError(await a.get('/api/admin/health'), 403, 'FORBIDDEN');
      // Alerts from the previous section may still be in the queue: wait for them to drain.
      await eventually(async () => {
        const h = conforms(S.AdminHealth, (await a.req('GET', '/api/admin/health', undefined, { headers: { 'X-Admin-Secret': ADMIN_SECRET } })).body, 'AdminHealth');
        eq([h.unprocessedWebhooks, h.unsentNotifications], [0, 0], 'stuck work');
      }, 'queue to drain');
    });
    await check('database invariants: every PAID request has exactly one Kora-verified payment; no orphan payments', async () => {
      const bad = await db.query(`
        SELECT r.id FROM "PaymentRequest" r LEFT JOIN "Payment" p ON p."requestId" = r.id
        WHERE (r.status = 'PAID') <> (p.id IS NOT NULL)`);
      eq(bad.rowCount, 0, 'PAID ⇔ payment');
      const dupAlerts = await db.query(`SELECT "dedupeKey" FROM "Notification" GROUP BY "dedupeKey" HAVING count(*) > 1`);
      eq(dupAlerts.rowCount, 0, 'duplicate notifications');
    });
    await check('every response carried an x-request-id; logout ends the session', async () => {
      const r = await a.get('/api/me');
      assert(r.headers.get('x-request-id'), 'x-request-id');
      eq((await a.post('/api/auth/logout')).status, 204, 'logout');
      expectError(await a.get('/api/me'), 401, 'UNAUTHENTICATED');
    });
  } finally {
    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      console.log('\n--- last Worker log lines ---');
      console.log(((worker as any).log as string[]).filter((l) => /error|warn|✘|exception/i.test(l)).slice(-25).join('\n'));
    }
    stopWorker(worker);
    await mock.close();
    await db.end();
    writeReport();
  }
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

function writeReport() {
  const passed = results.filter((r) => r.ok).length;
  const lines = [
    `# Paidar backend: end-to-end run (contract 1.1.0)`,
    ``,
    `${new Date().toISOString()} · **${passed}/${results.length} passed** · Worker on wrangler dev (workerd), KORA_MODE=live against mock Kora/Telegram (real API formats)`,
    ``,
    `| | Section | Check | ms |`,
    `| --- | --- | --- | --- |`,
    ...results.map((r) => `| ${r.ok ? '✔' : '✘'} | ${r.section} | ${r.name}${r.detail ? `<br>\`${r.detail.split('\n')[0]!.replace(/\|/g, '\\|')}\`` : ''} | ${r.ms} |`),
  ];
  writeFileSync('e2e/last-run.md', lines.join('\n') + '\n');
  console.log(`\n${passed}/${results.length} checks passed. Report: backend/e2e/last-run.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
