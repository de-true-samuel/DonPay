/**
 * The core money path, end to end through HTTP, webhook, queue and DB:
 * create job → send → Kora webhook → verify → PAID → alert → balance → fully paid.
 */
import { describe, expect, it } from 'vitest';
import { createDepositJob, json, retryableKoraError, setupHarness, signedWebhook } from '../helpers';

const h = setupHarness();

async function sendFirstRequest(token: string) {
  const job = await createDepositJob(h, token);
  const reqId = job.requests[0].id as string;
  const res = await h.api('POST', `/api/requests/${reqId}/send`, { token });
  expect(res.status).toBe(200);
  const sent = await json(res);
  return { job, reqId, sent, reference: (await h.db.paymentRequest.findUniqueOrThrow({ where: { id: reqId } })).koraReference! };
}

async function deliverWebhook(reference: string, status = 'success') {
  const { body, signature } = await signedWebhook({ event: 'charge.success', data: { reference, status, amount: 25000 } });
  return h.app.request('/webhooks/kora', { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'x-korapay-signature': signature } });
}

describe('job creation and send', () => {
  it('creates a deposit job with a DRAFT deposit request and derived money fields', async () => {
    const { token } = await h.login();
    const job = await createDepositJob(h, token);
    expect(job).toMatchObject({
      service: 'Bridal makeup',
      totalKobo: '5000000',
      depositKobo: '2500000',
      paidKobo: '0',
      balanceKobo: '5000000',
      status: 'NOT_STARTED',
      readyToStart: false,
      customer: { name: 'Tolu Adeyemi', phone: '+2348031234567' },
      openRequest: null,
    });
    expect(job.requests).toHaveLength(1);
    expect(job.requests[0]).toMatchObject({ kind: 'DEPOSIT', amountKobo: '2500000', status: 'DRAFT', accountNumber: null });
    expect(job.requests[0].payLink).toMatch(/^https:\/\/api\.test\/p\/[A-Za-z0-9_-]{22}$/);
  });

  it('send allocates a Kora account at send time and returns the prepared message', async () => {
    const { token } = await h.login();
    const { sent, reference } = await sendFirstRequest(token);
    expect(sent.request).toMatchObject({ status: 'SENT', bankName: 'Wema Bank', amountKobo: '2500000' });
    expect(sent.request.accountNumber).toMatch(/^78\d{8}$/);
    expect(sent.job.openRequest.id).toBe(sent.request.id);
    expect(sent.message.text.split('\n')[1]).toBe('Pay ₦25,000 for Bridal makeup (deposit)');
    expect(sent.message.details).toMatchObject({ accountNumber: sent.request.accountNumber, amountKobo: 2500000, amountPlain: '25000.00' });
    expect(sent.message.text).toContain(sent.request.accountNumber);
    expect(sent.message.whatsappUrl).toMatch(/^https:\/\/wa\.me\/2348031234567\?text=/);
    expect(reference).toBe(`KE-${sent.request.id}-1`);
    expect(h.kora.created[0]).toMatchObject({ reference, amountKobo: 2500000n, notificationUrl: 'https://api.test/webhooks/kora' });
  });

  it('send is idempotent: a retry returns the same account without calling Kora again', async () => {
    const { token } = await h.login();
    const { reqId, sent } = await sendFirstRequest(token);
    const again = await json(await h.api('POST', `/api/requests/${reqId}/send`, { token }));
    expect(again.request.accountNumber).toBe(sent.request.accountNumber);
    expect(h.kora.created).toHaveLength(1);
  });

  it('Kora failure leaves the request DRAFT and returns 502 KORA_UNAVAILABLE', async () => {
    const { token } = await h.login();
    const job = await createDepositJob(h, token);
    h.kora.failNextCreate = retryableKoraError();
    const res = await h.api('POST', `/api/requests/${job.requests[0].id}/send`, { token });
    expect(res.status).toBe(502);
    expect((await json(res)).error.code).toBe('KORA_UNAVAILABLE');
    expect((await h.db.paymentRequest.findUniqueOrThrow({ where: { id: job.requests[0].id } })).status).toBe('DRAFT');
    // Retry succeeds with the same reference.
    const retry = await h.api('POST', `/api/requests/${job.requests[0].id}/send`, { token });
    expect(retry.status).toBe(200);
  });

  it('blocks a second open request on the same job', async () => {
    const { token } = await h.login();
    const { job } = await sendFirstRequest(token);
    const res = await h.api('POST', `/api/jobs/${job.id}/requests/balance`, { token, body: {} });
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe('OPEN_REQUEST_EXISTS');
  });

  it('the database itself rejects two open requests per job (partial unique index)', async () => {
    const { token, providerId } = await h.login();
    const { job } = await sendFirstRequest(token);
    await expect(
      h.db.paymentRequest.create({
        data: { providerId, jobId: job.id, kind: 'BALANCE', amountKobo: 1n, publicToken: 'x'.repeat(22), status: 'SCHEDULED' },
      }),
    ).rejects.toThrow(/one_open_request_per_job|Unique constraint/);
  });
});

describe('payment confirmation', () => {
  it('webhook → verify → PAID, alert text, ready to start', async () => {
    const { token, providerId } = await h.login();
    await h.db.provider.update({ where: { id: providerId }, data: { telegramChatId: 555n } });
    const { job, reqId, reference } = await sendFirstRequest(token);

    h.kora.pay(reference, 2_500_000n);
    const res = await deliverWebhook(reference);
    expect(res.status).toBe(200);
    expect(h.queue).toEqual([expect.objectContaining({ type: 'kora.verify', reference })]);
    await h.drain();

    const detail = await json(await h.api('GET', `/api/jobs/${job.id}`, { token }));
    expect(detail).toMatchObject({ status: 'PART_PAID', paidKobo: '2500000', verifiedPaidKobo: '2500000', balanceKobo: '2500000', readyToStart: true, openRequest: null });
    expect(detail.requests[0]).toMatchObject({ id: reqId, status: 'PAID' });
    expect(detail.payments[0]).toMatchObject({ source: 'KORA_VERIFIED', amountKobo: '2500000', payerName: 'TOLU ADEYEMI', payerAccountMasked: '******6789' });

    expect(h.telegram.sent).toHaveLength(1);
    expect(h.telegram.sent[0]!.chatId).toBe('555');
    expect(h.telegram.sent[0]!.text.split('\n')[0]).toBe('Paid ✔ ₦25,000 from Tolu for Bridal makeup. Deposit received. Ready to start ✔');
    expect(h.telegram.sent[0]!.buttons?.[0]?.[0]?.url).toMatch(/^https:\/\/wa\.me\/2348031234567\?text=/);
    const event = await h.db.webhookEvent.findFirstOrThrow();
    expect(event.processedAt).not.toBeNull();
  });

  it('a duplicate webhook changes nothing', async () => {
    const { token } = await h.login();
    const { reference } = await sendFirstRequest(token);
    h.kora.pay(reference, 2_500_000n);
    await deliverWebhook(reference);
    await h.drain();
    const second = await json(await deliverWebhook(reference));
    expect(second).toEqual({ ok: true, duplicate: true });
    expect(h.queue).toHaveLength(0);
    expect(await h.db.payment.count()).toBe(1);
    expect(await h.db.webhookEvent.count()).toBe(1);
  });

  it('duplicate queue deliveries (even concurrent) record exactly one payment and one alert', async () => {
    const { token, providerId } = await h.login();
    await h.db.provider.update({ where: { id: providerId }, data: { telegramChatId: 555n } });
    const { reference } = await sendFirstRequest(token);
    h.kora.pay(reference, 2_500_000n);
    const { verifyReference } = await import('../../src/services/payments');
    const results = await Promise.all([1, 2, 3].map(() => verifyReference(h.deps, reference, null)));
    expect(results.filter((r) => r.outcome === 'recorded')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'duplicate')).toHaveLength(2);
    await h.drain();
    expect(await h.db.payment.count()).toBe(1);
    expect(await h.db.notification.count({ where: { kind: 'PAID_ALERT' } })).toBe(1);
    expect(h.telegram.sent).toHaveLength(1);
  });

  it('a webhook alone is never proof: if Kora says pending, nothing is recorded', async () => {
    const { token } = await h.login();
    const { reqId, reference } = await sendFirstRequest(token);
    await deliverWebhook(reference); // Kora query still says "processing"
    await h.drain();
    expect(await h.db.payment.count()).toBe(0);
    expect((await h.db.paymentRequest.findUniqueOrThrow({ where: { id: reqId } })).status).toBe('SENT');
  });

  it('rejects a forged webhook (bad signature) and records it for audit', async () => {
    const { token } = await h.login();
    const { reference } = await sendFirstRequest(token);
    const res = await h.app.request('/webhooks/kora', {
      method: 'POST',
      body: JSON.stringify({ event: 'charge.success', data: { reference, status: 'success' } }),
      headers: { 'x-korapay-signature': 'f'.repeat(64) },
    });
    expect(res.status).toBe(401);
    expect(h.queue).toHaveLength(0);
    expect(await h.db.webhookEvent.count({ where: { signatureOk: false } })).toBe(1);
  });

  it('unknown reference → Needs review (unattributed)', async () => {
    h.kora.pay('KE-unknown-1', 1_000_00n);
    await deliverWebhook('KE-unknown-1');
    await h.drain();
    const items = await h.db.reviewItem.findMany();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'UNMATCHED_REFERENCE', providerId: null });
  });

  it('amount mismatch and payer-name mismatch are flagged but the payment is still recorded', async () => {
    const { token } = await h.login();
    const { job, reference } = await sendFirstRequest(token);
    h.kora.pay(reference, 2_000_000n, { payerName: 'CHINEDU OKAFOR' });
    await deliverWebhook(reference);
    await h.drain();
    const detail = await json(await h.api('GET', `/api/jobs/${job.id}`, { token }));
    expect(detail.paidKobo).toBe('2000000');
    expect(detail.readyToStart).toBe(false); // ₦20,000 < ₦25,000 deposit
    expect(detail.openReviewItems.map((r: any) => r.kind).sort()).toEqual(['AMOUNT_MISMATCH', 'PAYER_NAME_DIFFERS']);
    expect(detail.openReviewItems.find((r: any) => r.kind === 'AMOUNT_MISMATCH').message).toBe('Kora accepted ₦20,000.00 but the request was for ₦25,000.00.');
  });

  it('a Kora outage during verification is retried, not lost', async () => {
    const { token } = await h.login();
    const { reference } = await sendFirstRequest(token);
    h.kora.pay(reference, 2_500_000n);
    await deliverWebhook(reference);
    h.kora.failQuery = retryableKoraError();
    const { retried } = await h.drain(1);
    expect(retried).toEqual([expect.objectContaining({ type: 'kora.verify', reference })]);
    expect(await h.db.payment.count()).toBe(0);
    h.kora.failQuery = null;
    h.queue.push(...retried);
    await h.drain();
    expect(await h.db.payment.count()).toBe(1);
  });
});

describe('deposit then balance', () => {
  it('creates an exact balance request and reaches FULLY_PAID', async () => {
    const { token } = await h.login();
    const { job, reference } = await sendFirstRequest(token);
    h.kora.pay(reference, 2_500_000n);
    await deliverWebhook(reference);
    await h.drain();

    const balRes = await h.api('POST', `/api/jobs/${job.id}/requests/balance`, { token, body: { send: true } });
    expect(balRes.status).toBe(201);
    const bal = await json(balRes);
    expect(bal.request).toMatchObject({ kind: 'BALANCE', amountKobo: '2500000', status: 'SENT' });
    expect(bal.message.text).toContain('(balance)');

    const balRef = (await h.db.paymentRequest.findUniqueOrThrow({ where: { id: bal.request.id } })).koraReference!;
    h.kora.pay(balRef, 2_500_000n);
    await deliverWebhook(balRef);
    await h.drain();

    const detail = await json(await h.api('GET', `/api/jobs/${job.id}`, { token }));
    expect(detail).toMatchObject({ status: 'FULLY_PAID', balanceKobo: '0', readyToStart: true });
    const nothing = await h.api('POST', `/api/jobs/${job.id}/requests/balance`, { token, body: {} });
    expect((await json(nothing)).error.code).toBe('NOTHING_OWED');
  });

  it('the public page turns into a receipt once paid', async () => {
    const { token } = await h.login();
    const { sent, reference } = await sendFirstRequest(token);
    const pageToken = sent.request.payLink.split('/p/')[1];
    const before = await json(await h.app.request(`/api/public/requests/${pageToken}`));
    expect(before).toMatchObject({ status: 'SENT', accountNumber: sent.request.accountNumber, customerFirstName: 'Tolu', receipt: null });
    expect(await json(await h.app.request(`/p/${pageToken}/status`))).toMatchObject({ state: 'waiting', expiresAt: sent.request.expiresAt });
    expect(JSON.stringify(before)).not.toContain('803123'); // no phone numbers on the public page

    h.kora.pay(reference, 2_500_000n);
    await deliverWebhook(reference);
    await h.drain();
    const after = await json(await h.app.request(`/api/public/requests/${pageToken}`));
    expect(after).toMatchObject({ status: 'PAID', accountNumber: null, receipt: { amountKobo: '2500000', jobBalanceKobo: '2500000' } });
    expect(after.receipt.reference).toMatch(/^KE-[A-Z0-9]{6}$/);
    const status = await json(await h.app.request(`/p/${pageToken}/status`));
    expect(status).toMatchObject({ state: 'paid', receipt: { amountKobo: 2500000, balanceKobo: 2500000, reference: after.receipt.reference } });

    const html = await (await h.app.request(`/p/${pageToken}`)).text();
    expect(html).toContain('<title>');
    expect(html).toContain('Payment received');
    expect((await h.app.request('/p/doesnotexistdoesnotexist')).status).toBe(404);
  });
});
