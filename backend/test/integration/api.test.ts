/** HTTP contract: auth, CSRF, tenancy, validation shape, customers, search, export, manual payments, Telegram. */
import { describe, expect, it } from 'vitest';
import { handleTelegramUpdate } from '../../src/services/telegram-bot';
import { createDepositJob, json, setupHarness } from '../helpers';

const h = setupHarness();

describe('auth and guards', () => {
  it('requires a session', async () => {
    const res = await h.api('GET', '/api/today');
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Please log in' } });
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('requires the CSRF header on changes', async () => {
    const { token } = await h.login();
    const res = await h.api('POST', '/api/customers', { token, body: { name: 'A', phone: '08031234567' }, headers: { 'X-Requested-With': 'nope' } });
    expect(res.status).toBe(403);
    expect((await json(res)).error.code).toBe('CSRF_HEADER_MISSING');
  });

  it('dev login sets an HttpOnly cookie that works on its own', async () => {
    const res = await h.api('POST', '/api/auth/dev-login', { body: { businessName: 'Ada Tailoring' } });
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^ke_session=[^;]+;/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    const me = await h.app.request('/api/me', { headers: { Cookie: cookie.split(';')[0]! } });
    expect(await json(me)).toMatchObject({ businessName: 'Ada Tailoring', telegramLinked: false, defaultReadyRule: 'AFTER_DEPOSIT', digestTime: null });
  });

  it('dev login is refused when disabled', async () => {
    h.deps.config.devLoginEnabled = false;
    const res = await h.api('POST', '/api/auth/dev-login', { body: { businessName: 'X Y' } });
    expect(res.status).toBe(403);
  });

  it('logout invalidates the session', async () => {
    const { token } = await h.login();
    expect((await h.api('POST', '/api/auth/logout', { token })).status).toBe(204);
    expect((await h.api('GET', '/api/me', { token })).status).toBe(401);
  });

  it('CORS allows only the configured frontend origin, with credentials', async () => {
    const ok = await h.app.request('/api/me', { method: 'OPTIONS', headers: { Origin: 'https://app.test', 'Access-Control-Request-Method': 'GET' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.test');
    expect(ok.headers.get('access-control-allow-credentials')).toBe('true');
    const bad = await h.app.request('/api/me', { method: 'OPTIONS', headers: { Origin: 'https://evil.test', 'Access-Control-Request-Method': 'GET' } });
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('tenant isolation', () => {
  it("one provider can never see or act on another provider's data", async () => {
    const a = await h.login('Provider A');
    const b = await h.login('Provider B');
    const job = await createDepositJob(h, a.token);
    const reqId = job.requests[0].id;
    for (const [method, path] of [
      ['GET', `/api/jobs/${job.id}`],
      ['POST', `/api/jobs/${job.id}/cancel`],
      ['POST', `/api/jobs/${job.id}/requests/balance`],
      ['POST', `/api/requests/${reqId}/send`],
      ['POST', `/api/requests/${reqId}/cancel`],
      ['GET', `/api/customers/${job.customer.id}`],
    ] as const) {
      const res = await h.api(method, path, { token: b.token, body: method === 'POST' ? {} : undefined });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    const listB = await json(await h.api('GET', '/api/jobs', { token: b.token }));
    expect(listB.items).toHaveLength(0);
    const searchB = await json(await h.api('GET', '/api/search?q=tolu', { token: b.token }));
    expect(searchB.items).toHaveLength(0);
    expect(h.kora.created).toHaveLength(0);
  });
});

describe('validation errors use the contract shape', () => {
  it('reports field errors, including nested ones', async () => {
    const { token } = await h.login();
    const res = await h.api('POST', '/api/jobs', {
      token,
      body: { customer: { name: 'Tolu', phone: '123' }, service: '', totalKobo: '25000.50', plan: 'DEPOSIT_BALANCE' },
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(body.error.details.fieldErrors)).toEqual(expect.arrayContaining(['service', 'totalKobo', 'customer.phone']));
  });

  it('deposit must be below the total', async () => {
    const { token } = await h.login();
    const res = await h.api('POST', '/api/jobs', {
      token,
      body: { customer: { name: 'Tolu', phone: '08031234567' }, service: 'Gele', totalKobo: '100000', plan: 'DEPOSIT_BALANCE', depositKobo: '100000' },
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error.details.fieldErrors.depositKobo).toEqual(['depositKobo must be less than totalKobo']);
  });

  it('accepts integer kobo as well as strings, and big amounts beyond 32-bit', async () => {
    const { token } = await h.login();
    const res = await h.api('POST', '/api/jobs', {
      token,
      body: { customer: { name: 'Big Event', phone: '08031234567' }, service: 'Wedding', totalKobo: 5_000_000_000, plan: 'FULL' },
    });
    expect(res.status).toBe(201);
    expect((await json(res)).totalKobo).toBe('5000000000'); // ₦50,000,000
  });
});

describe('customers', () => {
  it('create, conflict on phone, reuse by phone when creating a job', async () => {
    const { token } = await h.login();
    const c = await json(await h.api('POST', '/api/customers', { token, body: { name: 'Tolu Adeyemi', phone: '0803 123 4567' } }));
    expect(c).toMatchObject({ name: 'Tolu Adeyemi', phone: '+2348031234567', messageConsent: false });
    const dup = await h.api('POST', '/api/customers', { token, body: { name: 'Other', phone: '+2348031234567' } });
    expect(dup.status).toBe(409);
    expect((await json(dup)).error.details.existingId).toBe(c.id);
    const job = await createDepositJob(h, token);
    expect(job.customer.id).toBe(c.id);
  });

  it('customer page has jobs and a newest-first timeline', async () => {
    const { token } = await h.login();
    const job = await createDepositJob(h, token);
    await h.db.job.update({ where: { id: job.id }, data: { createdAt: h.clock.now() } }); // align DB clock with test clock
    h.clock.advance(60_000);
    await h.api('POST', `/api/requests/${job.requests[0].id}/send`, { token });
    const page = await json(await h.api('GET', `/api/customers/${job.customer.id}`, { token }));
    expect(page.customer).toMatchObject({ jobCount: 1, outstandingKobo: '5000000' });
    expect(page.jobs).toHaveLength(1);
    expect(page.timeline.map((e: any) => e.type)).toEqual(['REQUEST_SENT', 'JOB_CREATED']);
  });

  it('imports a CSV, deduplicating by phone and reporting bad rows', async () => {
    const { token } = await h.login();
    await h.api('POST', '/api/customers', { token, body: { name: 'Existing', phone: '08030000001' } });
    const csv = 'name,phone,consent\nAda,08030000001,yes\nBola,0803 000 0002,yes\nBola again,+2348030000002,no\n,08030000003,\nChi,12345,\n';
    const result = await json(await h.api('POST', '/api/customers/import', { token, body: { csv } }));
    expect(result).toEqual({
      created: 1,
      skipped: 2,
      errors: [
        { line: 5, message: 'Missing name' },
        { line: 6, message: 'Invalid phone "12345"' },
      ],
    });
    const list = await json(await h.api('GET', '/api/customers?q=bola', { token }));
    expect(list.items).toHaveLength(1);
    // BE-15: the consent column is ignored; the deprecated field always reads false.
    expect(list.items[0].messageConsent).toBe(false);
  });
});

describe('search', () => {
  it('finds by name, amount shorthand, phone, and filter chips', async () => {
    const { token } = await h.login();
    const tolu = await createDepositJob(h, token);
    await createDepositJob(h, token, { customer: { name: 'Chinedu Okafor', phone: '08099998888' }, service: 'Agbada', totalKobo: '12000000', depositKobo: '4000000' });

    const byName = await json(await h.api('GET', '/api/search?q=tolu', { token }));
    expect(byName.items.map((j: any) => j.id)).toEqual([tolu.id]);

    const byAmount = await json(await h.api('GET', `/api/search?q=${encodeURIComponent('25k')}`, { token }));
    expect(byAmount.items.map((j: any) => j.id)).toEqual([tolu.id]);
    expect(byAmount.interpreted).toEqual({ text: null, phone: null, amountKobo: '2500000' });

    const byPhone = await json(await h.api('GET', '/api/search?q=0809999', { token }));
    expect(byPhone.items).toHaveLength(1);
    expect(byPhone.items[0].service).toBe('Agbada');

    const byService = await json(await h.api('GET', '/api/search?q=AGBADA', { token }));
    expect(byService.items).toHaveLength(1);

    await h.api('POST', `/api/requests/${tolu.requests[0].id}/send`, { token });
    const waiting = await json(await h.api('GET', '/api/search?status=waiting', { token }));
    expect(waiting.items.map((j: any) => j.id)).toEqual([tolu.id]);
    const unpaid = await json(await h.api('GET', '/api/search?view=unpaid_balances', { token }));
    expect(unpaid.items).toHaveLength(2);
    const bad = await h.api('GET', '/api/search?status=bogus', { token });
    expect(bad.status).toBe(400);
  });

  it('paginates with an opaque cursor', async () => {
    const { token } = await h.login();
    for (let i = 0; i < 3; i++) await createDepositJob(h, token, { service: `Job ${i}` });
    const p1 = await json(await h.api('GET', '/api/search?limit=2', { token }));
    expect(p1.items).toHaveLength(2);
    const p2 = await json(await h.api('GET', `/api/search?limit=2&cursor=${p1.nextCursor}`, { token }));
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    const jobs1 = await json(await h.api('GET', '/api/jobs?limit=2', { token }));
    const jobs2 = await json(await h.api('GET', `/api/jobs?limit=2&cursor=${jobs1.nextCursor}`, { token }));
    expect(new Set([...jobs1.items, ...jobs2.items].map((j: any) => j.id)).size).toBe(3);
  });
});

describe('manual payments and export', () => {
  it('manual cash counts towards balance but not Ready to start, and is labelled in the export', async () => {
    const { token } = await h.login();
    const job = await createDepositJob(h, token);
    const res = await h.api('POST', `/api/jobs/${job.id}/payments/manual`, { token, body: { amountKobo: '2500000', note: 'Cash at fitting' } });
    expect(res.status).toBe(201);
    expect(await json(res)).toMatchObject({ source: 'MANUAL', requestId: null, note: 'Cash at fitting' });
    const detail = await json(await h.api('GET', `/api/jobs/${job.id}`, { token }));
    expect(detail).toMatchObject({ paidKobo: '2500000', verifiedPaidKobo: '0', readyToStart: false, hasUnverifiedPayments: true, status: 'PART_PAID' });

    const csvRes = await h.api('GET', '/api/export.csv', { token });
    expect(csvRes.headers.get('content-type')).toContain('text/csv');
    const lines = (await csvRes.text()).trim().split('\r\n');
    expect(lines[0]).toBe('date,customer,phone,service,request_kind,amount_naira,source,payer_name,kora_reference,job_total_naira,job_balance_naira');
    expect(lines[1]).toContain('25000.00,manual (not verified by Kora),unknown');
  });

  it('cancelling a job cancels its open request', async () => {
    const { token } = await h.login();
    const job = await createDepositJob(h, token);
    await h.api('POST', `/api/requests/${job.requests[0].id}/send`, { token });
    const cancelled = await json(await h.api('POST', `/api/jobs/${job.id}/cancel`, { token }));
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.requests[0].status).toBe('CANCELLED');
    const send = await h.api('POST', `/api/jobs/${job.id}/requests/balance`, { token, body: {} });
    expect((await json(send)).error.code).toBe('INVALID_STATE');
  });
});

describe('fake Kora mode: simulated payments for the frontend and demo', () => {
  it('records a simulated payment through the real path, only in fake mode', async () => {
    const { token } = await h.login();
    const job = await createDepositJob(h, token);
    const reqId = job.requests[0].id;
    await h.api('POST', `/api/requests/${reqId}/send`, { token });
    const refused = await h.api('POST', `/api/dev/simulate-payment/${reqId}`, { token, body: {} });
    expect(refused.status).toBe(403);

    h.deps.config.koraMode = 'fake';
    const ok = await json(await h.api('POST', `/api/dev/simulate-payment/${reqId}`, { token, body: {} }));
    expect(ok.outcome).toBe('recorded');
    const detail = await json(await h.api('GET', `/api/jobs/${job.id}`, { token }));
    expect(detail.payments[0]).toMatchObject({ payerDetailsSimulated: true, payerName: 'SIMULATED PAYER' });
    expect(detail.readyToStart).toBe(true);
  });
});

describe('Telegram bot', () => {
  const update = (text: string, chatId = 4242) => ({ message: { text, chat: { id: chatId, type: 'private' }, from: { first_name: 'Tolu', username: 'tolu' } } });

  it('/start creates a provider and sends a one-time login link that exchanges for a session', async () => {
    await handleTelegramUpdate(h.deps, update('/start'));
    const provider = await h.db.provider.findFirstOrThrow({ where: { telegramChatId: 4242n } });
    expect(provider.businessName).toBe("Tolu's business");
    const msg = h.telegram.sent[0]!;
    const url = msg.buttons![0]![0]!.url;
    expect(url).toMatch(/^https:\/\/app\.test\/auth\?t=/);
    const t = decodeURIComponent(url.split('t=')[1]!);

    const ex = await h.api('POST', '/api/auth/exchange', { body: { token: t } });
    expect(ex.status).toBe(200);
    expect((await json(ex)).provider).toMatchObject({ id: provider.id, telegramLinked: true });
    const again = await h.api('POST', '/api/auth/exchange', { body: { token: t } });
    expect(again.status).toBe(401);
  });

  it('login links expire after 10 minutes', async () => {
    await handleTelegramUpdate(h.deps, update('/login'));
    const t = decodeURIComponent(h.telegram.sent[0]!.buttons![0]![0]!.url.split('t=')[1]!);
    h.clock.advance(11 * 60_000);
    expect((await h.api('POST', '/api/auth/exchange', { body: { token: t } })).status).toBe(401);
  });

  it('connects an existing (dev-login) account through the deep link', async () => {
    const { token, providerId } = await h.login();
    const link = await json(await h.api('POST', '/api/me/telegram-link', { token }));
    expect(link.url).toMatch(/^https:\/\/t\.me\/KoboExactTestBot\?start=link_/);
    await handleTelegramUpdate(h.deps, update(`/start ${link.url.split('start=')[1]}`, 9001));
    expect((await h.db.provider.findUniqueOrThrow({ where: { id: providerId } })).telegramChatId).toBe(9001n);
    expect(h.telegram.sent.at(-1)!.text).toContain('Connected ✔');
  });

  it('/today summarises counts', async () => {
    await handleTelegramUpdate(h.deps, update('/start'));
    await handleTelegramUpdate(h.deps, update('/today'));
    expect(h.telegram.sent.at(-1)!.text).toContain('✔ Paid today: 0');
  });

  it('the webhook route checks the secret token', async () => {
    const bad = await h.app.request('/webhooks/telegram', { method: 'POST', body: JSON.stringify(update('/help')) });
    expect(bad.status).toBe(401);
    const ok = await h.app.request('/webhooks/telegram', {
      method: 'POST',
      body: JSON.stringify(update('/help')),
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'tg-secret', 'Content-Type': 'application/json' },
    });
    expect(ok.status).toBe(200);
    expect(h.telegram.sent.at(-1)!.text).toContain('/login');
  });
});

describe('ops endpoints', () => {
  it('health and admin health', async () => {
    expect(await json(await h.app.request('/health'))).toMatchObject({ ok: true, db: true });
    expect((await h.app.request('/api/admin/health')).status).toBe(403);
    const admin = await json(await h.app.request('/api/admin/health', { headers: { 'X-Admin-Secret': 'admin-secret' } }));
    expect(admin).toMatchObject({ unprocessedWebhooks: 0, unsentNotifications: 0, openReviewItems: 0 });
  });
});
