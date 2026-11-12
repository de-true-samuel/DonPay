/**
 * Contract 1.1.0 (Paidar spec, Paidar_Backend_Implementation_Spec.md). Test ids (T6, T7, …) refer to
 * spec §8; BE-xx to the work items.
 */
import { describe, expect, it } from 'vitest';
import { loadConfig, type Env } from '../../src/config';
import { runSweep } from '../../src/services/background';
import { createDepositJob, json, retryableKoraError, setupHarness, signedWebhook } from '../helpers';

const h = setupHarness();
const MIN = 60_000;

async function draftJob(token: string, overrides: Record<string, unknown> = {}) {
  const job = await createDepositJob(h, token, overrides);
  return { job, reqId: job.requests[0].id as string };
}

async function sentJob(token: string, overrides: Record<string, unknown> = {}) {
  const { job, reqId } = await draftJob(token, overrides);
  const sent = await json(await h.api('POST', `/api/requests/${reqId}/send`, { token }));
  const reference = (await h.db.paymentRequest.findUniqueOrThrow({ where: { id: reqId } })).koraReference!;
  const publicToken = sent.request.payLink.split('/p/')[1] as string;
  return { job, reqId, reference, sent, publicToken };
}

const claim = (publicToken: string, headers: Record<string, string> = { 'X-Requested-With': 'kobo-exact' }) =>
  h.app.request(`/p/${publicToken}/claim-paid`, { method: 'POST', headers: { 'cf-connecting-ip': '102.89.1.1', ...headers } });

describe('idempotency keys (BE-09, T6, T7)', () => {
  it('a double tap on "Get payment details" creates one account and replays the first result', async () => {
    const { token } = await h.login();
    const { reqId } = await draftJob(token);
    const headers = { 'Idempotency-Key': 'tap-1' };
    const a = await h.api('POST', `/api/requests/${reqId}/send`, { token, headers });
    const b = await h.api('POST', `/api/requests/${reqId}/send`, { token, headers });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await json(b)).toEqual(await json(a));
    expect(h.kora.created).toHaveLength(1);
  });

  it('the same key with a different body is rejected; keys are per provider', async () => {
    const { token } = await h.login();
    const { job } = await draftJob(token);
    const headers = { 'Idempotency-Key': 'cash-1' };
    const ok = await h.api('POST', `/api/jobs/${job.id}/payments/manual`, { token, headers, body: { amountKobo: '100000' } });
    expect(ok.status).toBe(201);
    const reused = await h.api('POST', `/api/jobs/${job.id}/payments/manual`, { token, headers, body: { amountKobo: '200000' } });
    expect(reused.status).toBe(422);
    expect((await json(reused)).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await h.db.payment.count({ where: { jobId: job.id } })).toBe(1);

    const other = await h.login();
    const created = await h.api('POST', '/api/jobs', {
      token: other.token,
      headers,
      body: { customer: { name: 'Ada Obi', phone: '08030000009' }, service: 'Braids', totalKobo: '1000000', plan: 'FULL' },
    });
    expect(created.status).toBe(201);
  });

  it('Kora down: clear error, request stays a draft, a retry with the same key creates exactly one account', async () => {
    const { token } = await h.login();
    const { reqId } = await draftJob(token);
    h.kora.failNextCreate = retryableKoraError();
    const headers = { 'Idempotency-Key': 'kora-down' };
    const failed = await h.api('POST', `/api/requests/${reqId}/send`, { token, headers });
    expect(failed.status).toBe(502);
    expect((await json(failed)).error.code).toBe('KORA_UNAVAILABLE');
    const row = await h.db.paymentRequest.findUniqueOrThrow({ where: { id: reqId } });
    expect(row).toMatchObject({ status: 'DRAFT', accountNumber: null });

    const retried = await h.api('POST', `/api/requests/${reqId}/send`, { token, headers });
    expect(retried.status).toBe(200);
    expect(h.kora.created).toHaveLength(1);
  });

  it('creating a job twice with one key creates one job', async () => {
    const { token } = await h.login();
    const body = { customer: { name: 'Ada Obi', phone: '08030000009' }, service: 'Braids', totalKobo: '1000000', plan: 'FULL' };
    const headers = { 'Idempotency-Key': 'job-1' };
    const a = await json(await h.api('POST', '/api/jobs', { token, headers, body }));
    const b = await json(await h.api('POST', '/api/jobs', { token, headers, body }));
    expect(b.id).toBe(a.id);
    expect(await h.db.job.count()).toBe(1);
  });

  it('expired keys are purged by the sweep after 24 hours', async () => {
    const { token } = await h.login();
    const { reqId } = await draftJob(token);
    await h.api('POST', `/api/requests/${reqId}/send`, { token, headers: { 'Idempotency-Key': 'old' } });
    h.clock.advance(25 * 60 * MIN);
    expect((await runSweep(h.deps)).idempotencyKeysPurged).toBe(1);
  });
});

describe('prepared messages (BE-01, BE-02, BE-07, BE-08, BE-12, T9)', () => {
  it('"Copy details again" returns the same account and message', async () => {
    const { token } = await h.login();
    const { reqId, sent } = await sentJob(token);
    const again = await json(await h.api('GET', `/api/requests/${reqId}/message`, { token }));
    expect(again).toEqual(sent.message);
    expect(h.kora.created).toHaveLength(1);
  });

  it('nudge: only for a waiting request with time left', async () => {
    const { token } = await h.login();
    const { reqId: draftId } = await draftJob(token);
    const notWaiting = await h.api('GET', `/api/requests/${draftId}/nudge-message`, { token });
    expect(notWaiting.status).toBe(409);
    expect((await json(notWaiting)).error.code).toBe('REQUEST_NOT_WAITING');

    const other = await h.login();
    const { reqId } = await sentJob(other.token);
    h.clock.advance(50 * MIN);
    const nudge = await json(await h.api('GET', `/api/requests/${reqId}/nudge-message`, { token: other.token }));
    expect(nudge.text).toContain('Your payment details expire in 10 minutes.');
    expect(nudge.details.amountPlain).toBe('25000.00');
    expect((await h.db.paymentRequest.findUniqueOrThrow({ where: { id: reqId } })).status).toBe('SENT'); // read-only

    h.clock.advance(11 * MIN);
    const expired = await h.api('GET', `/api/requests/${reqId}/nudge-message`, { token: other.token });
    expect((await json(expired)).error.code).toBe('REQUEST_EXPIRED');
  });

  it('start message: 409 until the job is ready to start', async () => {
    const { token } = await h.login();
    const { job, reqId } = await sentJob(token);
    const early = await h.api('GET', `/api/jobs/${job.id}/start-message`, { token });
    expect(early.status).toBe(409);
    expect((await json(early)).error.code).toBe('JOB_NOT_READY');

    const req = await h.db.paymentRequest.findUniqueOrThrow({ where: { id: reqId } });
    h.kora.pay(req.koraReference!, 2_500_000n);
    await h.api('POST', `/api/requests/${reqId}/recheck`, { token });
    const start = await json(await h.api('GET', `/api/jobs/${job.id}/start-message`, { token }));
    expect(start.text).toBe("Hi Tolu, payment received for Bridal makeup. We're starting. Thank you!\n" + (await h.db.provider.findFirstOrThrow()).businessName);
    expect(start.payLink).toBe(req && `https://api.test/p/${req.publicToken}`);
  });

  it('a Pidgin customer gets Pidgin wording', async () => {
    const { token } = await h.login();
    const { sent } = await sentJob(token, { customer: { name: 'Tolu Adeyemi', phone: '0803 123 4567', messageLanguage: 'pcm' } });
    expect(sent.message.language).toBe('pcm');
    expect(sent.message.text).toContain('Abeg pay ₦25,000 for Bridal makeup (deposit)');
    expect(sent.job.customer).toBeDefined();
    const customers = await json(await h.api('GET', '/api/customers', { token }));
    expect(customers.items[0]).toMatchObject({ messageLanguage: 'pcm', messageConsent: false });
  });
});

describe('copied marker (BE-05)', () => {
  it('sets detailsCopiedAt once; later calls return the first value', async () => {
    const { token } = await h.login();
    const { reqId } = await draftJob(token);
    expect((await h.api('POST', `/api/requests/${reqId}/copied`, { token })).status).toBe(409);
    await h.api('POST', `/api/requests/${reqId}/send`, { token });
    const first = await json(await h.api('POST', `/api/requests/${reqId}/copied`, { token }));
    h.clock.advance(5 * MIN);
    const second = await json(await h.api('POST', `/api/requests/${reqId}/copied`, { token }));
    expect(first.detailsCopiedAt).toBe('2026-11-05T10:00:00.000Z');
    expect(second.detailsCopiedAt).toBe(first.detailsCopiedAt);
  });
});

describe('scheduled reminders (BE-03, BE-04, T10)', () => {
  it('no account at scheduling; at the time: Telegram reminder with a job link and an entry in dueReminders', async () => {
    const { token, providerId } = await h.login();
    await h.db.provider.update({ where: { id: providerId }, data: { telegramChatId: 777n } });
    const { job, reqId } = await draftJob(token);
    await h.api('POST', `/api/requests/${reqId}/schedule`, { token, body: { scheduledFor: '2026-11-05T12:00:00.000Z' } });
    expect(h.kora.created).toHaveLength(0);
    let today = await json(await h.api('GET', '/api/today', { token }));
    expect(today.counts.dueReminders).toBe(0);

    h.clock.advance(2 * 60 * MIN);
    await runSweep(h.deps);
    await h.drain();
    expect(h.kora.created).toHaveLength(0);
    const reminder = h.telegram.sent.find((m) => m.text.includes('Get payment details'))!;
    expect(reminder.buttons![0]![0]!.url).toBe(`https://app.test/jobs/${job.id}`);

    today = await json(await h.api('GET', '/api/today', { token }));
    expect(today.counts.dueReminders).toBe(1);
    expect(today.dueReminders[0].request).toMatchObject({ id: reqId, status: 'SCHEDULED', accountNumber: null });

    await h.api('POST', `/api/requests/${reqId}/send`, { token });
    today = await json(await h.api('GET', '/api/today', { token }));
    expect(today.dueReminders).toHaveLength(0); // excluded once it has an account
  });

  it('optional next-morning follow-up when the reminder is still due', async () => {
    const { token, providerId } = await h.login();
    await h.db.provider.update({ where: { id: providerId }, data: { telegramChatId: 777n } });
    const { reqId } = await draftJob(token);
    await h.api('POST', `/api/requests/${reqId}/schedule`, { token, body: { scheduledFor: '2026-11-05T12:00:00.000Z' } });
    h.deps.config.reminderFollowUpMinute = 8 * 60;
    h.clock.current = new Date('2026-11-05T13:00:00.000Z');
    await runSweep(h.deps);
    h.clock.current = new Date('2026-11-06T06:30:00.000Z'); // 7:30 Lagos: too early
    expect((await runSweep(h.deps)).followUpPrompts).toBe(0);
    h.clock.current = new Date('2026-11-06T07:05:00.000Z'); // 8:05 Lagos
    expect((await runSweep(h.deps)).followUpPrompts).toBe(1);
    expect((await runSweep(h.deps)).followUpPrompts).toBe(0);
    await h.drain();
    expect(h.telegram.sent.filter((m) => m.text.startsWith('Reminder from yesterday'))).toHaveLength(1);
  });
});

describe('"I\'ve paid" claim and recheck (BE-06, T11)', () => {
  it('the claim alone changes nothing; the provider is alerted; the recheck finds the delayed payment', async () => {
    const { token, providerId } = await h.login();
    await h.db.provider.update({ where: { id: providerId }, data: { telegramChatId: 777n } });
    const { reqId, reference, publicToken } = await sentJob(token);

    const res = await claim(publicToken);
    expect(res.status).toBe(202);
    expect(await json(res)).toEqual({ ok: true });
    const row = await h.db.paymentRequest.findUniqueOrThrow({ where: { id: reqId } });
    expect(row.status).toBe('SENT');
    expect(row.customerClaimedPaidAt?.toISOString()).toBe('2026-11-05T10:00:00.000Z');
    expect(await h.db.claimEvent.count({ where: { requestId: reqId } })).toBe(1);

    // Kora has the money; the webhook was lost. The queued recheck finds it.
    h.kora.pay(reference, 2_500_000n);
    await h.drain();
    expect((await h.db.paymentRequest.findUniqueOrThrow({ where: { id: reqId } })).status).toBe('PAID');
    const texts = h.telegram.sent.map((m) => m.text);
    expect(texts.some((t) => t.startsWith('Tolu says they have paid ₦25,000'))).toBe(true);
    expect(texts.some((t) => t.startsWith('Paid ✔'))).toBe(true);
  });

  it('claims are rate-limited per request, need the CSRF header, and reveal nothing for unknown tokens', async () => {
    const { token } = await h.login();
    const { publicToken, reqId } = await sentJob(token);
    expect((await claim(publicToken, {})).status).toBe(403);
    for (let i = 0; i < 3; i++) expect((await claim(publicToken)).status).toBe(202);
    expect((await claim(publicToken)).status).toBe(429);
    expect(await h.db.notification.count({ where: { kind: 'CUSTOMER_CLAIMED_PAID' } })).toBe(1); // one ping per hour
    expect((await claim('doesnotexistdoesnotexist')).status).toBe(404);
    const row = await h.db.paymentRequest.findUniqueOrThrow({ where: { id: reqId } });
    expect(row.status).toBe('SENT');
  });

  it('recheck is idempotent and never double-credits a payment the webhook already recorded', async () => {
    const { token } = await h.login();
    const { reqId, reference } = await sentJob(token);
    h.kora.pay(reference, 2_500_000n);
    const { body, signature } = await signedWebhook({ event: 'charge.success', data: { reference, status: 'success', amount: 25000 } });
    await h.app.request('/webhooks/kora', { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'x-korapay-signature': signature } });
    await h.drain();
    const a = await json(await h.api('POST', `/api/requests/${reqId}/recheck`, { token }));
    const b = await json(await h.api('POST', `/api/requests/${reqId}/recheck`, { token }));
    expect(a.request.status).toBe('PAID');
    expect(b.job.paidKobo).toBe('2500000');
    expect(await h.db.payment.count({ where: { requestId: reqId } })).toBe(1);
  });

  it('recheck while Kora is down returns KORA_UNAVAILABLE', async () => {
    const { token } = await h.login();
    const { reqId } = await sentJob(token);
    h.kora.failQuery = retryableKoraError();
    const res = await h.api('POST', `/api/requests/${reqId}/recheck`, { token });
    expect(res.status).toBe(502);
  });
});

describe('background reconciliation (BE-14)', () => {
  it('re-queries waiting requests every 2 minutes and records a payment whose webhook never came', async () => {
    const { token } = await h.login();
    const { reqId, reference } = await sentJob(token);
    expect((await runSweep(h.deps)).reconciliations).toBe(0); // just sent
    h.clock.advance(3 * MIN);
    expect((await runSweep(h.deps)).reconciliations).toBe(1);
    expect((await runSweep(h.deps)).reconciliations).toBe(0); // stamped; not again within 2 minutes
    await h.drain();
    expect((await h.db.paymentRequest.findUniqueOrThrow({ where: { id: reqId } })).status).toBe('SENT');

    h.kora.pay(reference, 2_500_000n);
    h.clock.advance(3 * MIN);
    expect((await runSweep(h.deps)).reconciliations).toBe(1);
    await h.drain();
    expect((await h.db.paymentRequest.findUniqueOrThrow({ where: { id: reqId } })).status).toBe('PAID');
  });

  it('keeps checking for 30 minutes after expiry: a late payment becomes "Paid after the account expired"', async () => {
    const { token } = await h.login();
    const { reqId, reference } = await sentJob(token);
    h.clock.advance(65 * MIN);
    await runSweep(h.deps);
    await h.drain();
    expect((await h.db.paymentRequest.findUniqueOrThrow({ where: { id: reqId } })).status).toBe('EXPIRED');

    h.kora.pay(reference, 2_500_000n);
    h.clock.advance(10 * MIN);
    await runSweep(h.deps);
    await h.drain();
    expect((await h.db.paymentRequest.findUniqueOrThrow({ where: { id: reqId } })).status).toBe('PAID');
    expect(await h.db.reviewItem.count({ where: { requestId: reqId, kind: 'PAID_AFTER_EXPIRY' } })).toBe(1);

    h.clock.advance(60 * MIN);
    expect((await runSweep(h.deps)).reconciliations).toBe(0);
  });

  it('admin health reports backlog and alerts', async () => {
    const health = await h.api('GET', '/api/admin/health', { headers: { 'x-admin-secret': 'admin-secret' } });
    expect(await json(health)).toMatchObject({ ok: true, alerts: [], reconciliationBacklog: 0, unprocessedWebhooks: 0 });
    expect((await h.api('GET', '/api/admin/health')).status).toBe(403);
  });
});

describe('duplicate account guard (spec 5.3)', () => {
  it('refuses to show an account number another live request already uses', async () => {
    const { token } = await h.login();
    await sentJob(token);
    const other = await h.login();
    const { reqId } = await draftJob(other.token);
    const original = h.kora.createSingleUseAccount.bind(h.kora);
    h.kora.createSingleUseAccount = async (input) => ({ ...(await original(input)), accountNumber: '7800000001' });
    const res = await h.api('POST', `/api/requests/${reqId}/send`, { token: other.token });
    expect(res.status).toBe(502);
    expect((await h.db.paymentRequest.findUniqueOrThrow({ where: { id: reqId } })).status).toBe('DRAFT');
  });
});

describe('provider account (BE-10, BE-11, BE-16)', () => {
  it('PATCH /api/me sets phone and onboardedAt', async () => {
    const { token } = await h.login();
    const me = await json(await h.api('PATCH', '/api/me', { token, body: { phone: '0803 555 0000', onboardedAt: '2026-11-05T10:00:00.000Z' } }));
    expect(me).toMatchObject({ phone: '+2348035550000', onboardedAt: '2026-11-05T10:00:00.000Z' });
    expect((await json(await h.api('PATCH', '/api/me', { token, body: { phone: null } }))).phone).toBeNull();
  });

  it('export, sign out everywhere, delete', async () => {
    const { token } = await h.login();
    const second = await h.api('POST', '/api/auth/dev-login', { body: { businessName: (await h.db.provider.findFirstOrThrow()).businessName } });
    const token2 = (await json(second)).sessionToken;
    const { job } = await sentJob(token);

    const exp = await json(await h.api('GET', '/api/me/export', { token }));
    expect(exp).toMatchObject({ contractVersion: '1.1.0', customers: [{ name: 'Tolu Adeyemi' }] });
    expect(exp.jobs[0].id).toBe(job.id);
    expect(exp.jobs[0].requests).toHaveLength(1);

    const wrong = await h.api('POST', '/api/me/delete', { token, body: { confirmBusinessName: 'nope' } });
    expect(wrong.status).toBe(400);
    const name = exp.provider.businessName;
    const live = await h.api('POST', '/api/me/delete', { token, body: { confirmBusinessName: name } });
    expect((await json(live)).error.code).toBe('INVALID_STATE'); // a customer could still pay

    expect((await h.api('POST', '/api/auth/logout-all', { token })).status).toBe(204);
    expect((await h.api('GET', '/api/me', { token: token2 })).status).toBe(401);

    const fresh = await h.login(name);
    await h.api('POST', `/api/jobs/${job.id}/cancel`, { token: fresh.token });
    expect((await h.api('POST', '/api/me/delete', { token: fresh.token, body: { confirmBusinessName: name.toUpperCase() } })).status).toBe(204);
    expect(await h.db.job.count()).toBe(0);
    expect(await h.db.customer.count()).toBe(0);
  });
});

describe('support view (BE-18)', () => {
  it('looks a request up by Kora reference or receipt number, admin only', async () => {
    const { token } = await h.login();
    const { reqId, reference } = await sentJob(token);
    h.kora.pay(reference, 2_500_000n);
    await h.api('POST', `/api/requests/${reqId}/recheck`, { token });
    const admin = { 'x-admin-secret': 'admin-secret' };
    const byRef = await json(await h.api('GET', `/api/admin/support/requests/${reference}`, { headers: admin }));
    expect(byRef.request).toMatchObject({ id: reqId, status: 'PAID', koraReference: reference });
    expect(byRef.payment.amountKobo).toBe('2500000');
    expect(byRef.notifications.length).toBeGreaterThan(0);

    const pub = await json(await h.app.request(`/api/public/requests/${byRef.request.payLink.split('/p/')[1]}`));
    const byReceipt = await json(await h.api('GET', `/api/admin/support/requests/${pub.receipt.reference}`, { headers: admin }));
    expect(byReceipt.request.id).toBe(reqId);
    expect((await h.api('GET', `/api/admin/support/requests/${reference}`)).status).toBe(403);
  });
});

describe('customer payment page (BE-13, T14, T15, T17)', () => {
  it('waiting page: small, no-store, noindex, CSP, every detail as plain text, first name only', async () => {
    const { token } = await h.login();
    const { sent, publicToken } = await sentJob(token);
    const res = await h.app.request(`/p/${publicToken}`);
    const html = await res.text();
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(new TextEncoder().encode(html).length).toBeLessThan(30 * 1024);
    for (const s of ['₦25,000.00', 'Wema Bank', sent.request.accountNumber, 'Pay exactly ₦25,000.00', 'This account is for this payment only', '25000.00', 'For Tolu:', "I've paid"]) {
      expect(html).toContain(s);
    }
    expect(html).not.toContain('Adeyemi');
    expect(html).not.toContain('803123');
    expect((await h.app.request(`/p/${publicToken}/status`)).headers.get('Cache-Control')).toBe('no-store');
  });

  it('expired and cancelled pages are friendly and offer the business contact when known', async () => {
    const { token, providerId } = await h.login();
    await h.db.provider.update({ where: { id: providerId }, data: { phoneE164: '+2348035550000' } });
    const { reqId, publicToken } = await sentJob(token);
    await h.api('POST', `/api/requests/${reqId}/cancel`, { token });
    const html = await (await h.app.request(`/p/${publicToken}`)).text();
    expect(html).toContain('This payment request was cancelled');
    expect(html).toContain('https://wa.me/2348035550000');
    expect(html).not.toContain('Wema Bank');
    const notFound = await h.app.request('/p/doesnotexistdoesnotexist');
    expect(notFound.status).toBe(404);
    expect(await notFound.text()).toContain('Payment link not found');
  });
});

describe('production safety (T16)', () => {
  const base = { APP_ENV: 'production', PUBLIC_BASE_URL: 'https://pay.x', FRONTEND_URL: 'https://app.x', FRONTEND_ORIGINS: 'https://app.x', KORA_SECRET_KEY: 'sk' } as unknown as Env;
  it('refuses dev login and the fake Kora (and with it simulate-payment) in production', () => {
    expect(() => loadConfig({ ...base, KORA_MODE: 'live', DEV_LOGIN_ENABLED: 'true' })).toThrow(/DEV_LOGIN_ENABLED/);
    expect(() => loadConfig({ ...base, KORA_MODE: 'fake' })).toThrow(/fake/);
    expect(loadConfig({ ...base, KORA_MODE: 'live' }).devLoginEnabled).toBe(false);
  });
});
