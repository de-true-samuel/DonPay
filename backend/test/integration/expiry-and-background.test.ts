/** Expiry vs late payment, resend, scheduled prompts, balance prompts, digest, outbox recovery. */
import { describe, expect, it } from 'vitest';
import { buildDigest, checkExpiry, runSweep } from '../../src/services/background';
import { createDepositJob, json, setupHarness } from '../helpers';

const h = setupHarness();
const MIN = 60_000;

async function sentJob(token: string) {
  const job = await createDepositJob(h, token);
  const reqId = job.requests[0].id as string;
  await h.api('POST', `/api/requests/${reqId}/send`, { token });
  const reference = (await h.db.paymentRequest.findUniqueOrThrow({ where: { id: reqId } })).koraReference!;
  return { job, reqId, reference };
}

describe('expiry', () => {
  it('cron enqueues past-expiry requests; the check marks them EXPIRED when Kora says unpaid', async () => {
    const { token } = await h.login();
    const { job, reqId } = await sentJob(token);
    h.clock.advance(61 * MIN); // past expiry but inside 2-minute grace
    expect((await runSweep(h.deps)).expiryChecks).toBe(0);
    h.clock.advance(2 * MIN);
    expect((await runSweep(h.deps)).expiryChecks).toBe(1);
    await h.drain();
    const req = await h.db.paymentRequest.findUniqueOrThrow({ where: { id: reqId } });
    expect(req.status).toBe('EXPIRED');

    const today = await json(await h.api('GET', '/api/today', { token }));
    expect(today.expired).toHaveLength(1);
    expect(today.expired[0].request.id).toBe(reqId);
    expect(today.expired[0].job.id).toBe(job.id);
  });

  it('a payment wins the race: Kora reports success during the expiry check', async () => {
    const { token } = await h.login();
    const { reqId, reference } = await sentJob(token);
    h.clock.advance(70 * MIN);
    h.kora.pay(reference, 2_500_000n);
    expect(await checkExpiry(h.deps, reqId)).toBe('paid');
    expect((await h.db.paymentRequest.findUniqueOrThrow({ where: { id: reqId } })).status).toBe('PAID');
  });

  it('money arriving after expiry is recorded and flagged; resend made a new request', async () => {
    const { token } = await h.login();
    const { job, reqId, reference } = await sentJob(token);
    h.clock.advance(70 * MIN);
    await checkExpiry(h.deps, reqId);

    // "Send again" creates a NEW request with a NEW account.
    const resend = await json(await h.api('POST', `/api/requests/${reqId}/resend`, { token }));
    expect(resend.request.id).not.toBe(reqId);
    expect(resend.request).toMatchObject({ status: 'SENT', kind: 'DEPOSIT', amountKobo: '2500000' });
    expect(h.kora.created).toHaveLength(2);

    // Customer pays the OLD account anyway.
    h.kora.pay(reference, 2_500_000n);
    const { verifyReference } = await import('../../src/services/payments');
    await verifyReference(h.deps, reference, null);

    const detail = await json(await h.api('GET', `/api/jobs/${job.id}`, { token }));
    expect(detail.requests.find((r: any) => r.id === reqId).status).toBe('PAID');
    expect(detail.openReviewItems.map((r: any) => r.kind)).toEqual(['PAID_AFTER_EXPIRY']);

    // Resolve by cancelling the replacement in one action.
    const item = detail.openReviewItems[0];
    const resolved = await json(
      await h.api('POST', `/api/review/${item.id}/resolve`, { token, body: { resolution: 'Customer paid old account', cancelRequestId: resend.request.id } }),
    );
    expect(resolved.resolvedAt).not.toBeNull();
    expect((await h.db.paymentRequest.findUniqueOrThrow({ where: { id: resend.request.id } })).status).toBe('CANCELLED');
  });

  it('resend on a still-valid SENT request re-shares the same account', async () => {
    const { token } = await h.login();
    const { reqId } = await sentJob(token);
    const again = await json(await h.api('POST', `/api/requests/${reqId}/resend`, { token }));
    expect(again.request.id).toBe(reqId);
    expect(h.kora.created).toHaveLength(1);
  });

  it('the public page shows an expired SENT request as expired before the sweep runs', async () => {
    const { token } = await h.login();
    const { reqId } = await sentJob(token);
    const r = await h.db.paymentRequest.findUniqueOrThrow({ where: { id: reqId } });
    h.clock.advance(61 * MIN);
    const page = await json(await h.app.request(`/p/${r.publicToken}/status`));
    expect(page).toMatchObject({ status: 'EXPIRED', accountNumber: null });
  });
});

describe('scheduled sends and balance prompts', () => {
  it('a scheduled request prompts the provider once; the account is only created on Send', async () => {
    const { token, providerId } = await h.login();
    await h.db.provider.update({ where: { id: providerId }, data: { telegramChatId: 777n } });
    const job = await createDepositJob(h, token);
    const reqId = job.requests[0].id;
    const sched = await h.api('POST', `/api/requests/${reqId}/schedule`, { token, body: { scheduledFor: '2026-11-05T12:00:00.000Z' } });
    expect((await json(sched)).request.status).toBe('SCHEDULED');
    expect(h.kora.created).toHaveLength(0);

    await runSweep(h.deps);
    expect(h.telegram.sent).toHaveLength(0);
    h.clock.advance(2 * 60 * MIN + MIN);
    await runSweep(h.deps);
    await runSweep(h.deps);
    await h.drain();
    expect(h.telegram.sent).toHaveLength(1);
    expect(h.telegram.sent[0]!.text).toContain("Time to send Tolu's deposit request");
    expect(h.kora.created).toHaveLength(0);

    const sent = await json(await h.api('POST', `/api/requests/${reqId}/send`, { token }));
    expect(sent.request.status).toBe('SENT');
  });

  it('rejects scheduling in the past', async () => {
    const { token } = await h.login();
    const job = await createDepositJob(h, token);
    const res = await h.api('POST', `/api/requests/${job.requests[0].id}/schedule`, { token, body: { scheduledFor: '2026-11-05T09:00:00.000Z' } });
    expect(res.status).toBe(400);
  });

  it('balance-due prompt fires on the due day, once', async () => {
    const { token, providerId } = await h.login();
    await h.db.provider.update({ where: { id: providerId }, data: { telegramChatId: 777n } });
    const { reference } = await sentJob(token); // balance due 2026-11-06 09:00Z
    h.kora.pay(reference, 2_500_000n);
    const { verifyReference } = await import('../../src/services/payments');
    await verifyReference(h.deps, reference, null);
    await h.drain();
    h.telegram.sent.length = 0;

    await runSweep(h.deps);
    expect(h.telegram.sent).toHaveLength(0); // not due yet today (5 Nov)

    h.clock.current = new Date('2026-11-06T07:00:00.000Z'); // 08:00 Lagos on the due day
    await runSweep(h.deps);
    await runSweep(h.deps);
    await h.drain();
    expect(h.telegram.sent).toHaveLength(1);
    expect(h.telegram.sent[0]!.text).toContain('Balance due today: ₦25,000 from Tolu for Bridal makeup.');

    const today = await json(await h.api('GET', '/api/today', { token }));
    expect(today.balancesDue).toHaveLength(1);
  });
});

describe('daily digest and outbox', () => {
  it('sends once per day even across several sweeps', async () => {
    const { token, providerId } = await h.login();
    await h.db.provider.update({ where: { id: providerId }, data: { telegramChatId: 777n } });
    await h.api('PATCH', '/api/me', { token, body: { digestTime: '11:30' } });
    await sentJob(token); // sent 10:00Z, valid until 11:00Z

    h.clock.current = new Date('2026-11-05T10:29:00.000Z'); // 11:29 Lagos
    expect((await runSweep(h.deps)).digests).toBe(0);
    h.clock.current = new Date('2026-11-05T10:30:00.000Z'); // 11:30 Lagos
    await runSweep(h.deps);
    await runSweep(h.deps);
    await h.drain();
    expect(h.telegram.sent).toHaveLength(1);
    expect(h.telegram.sent[0]!.text).toContain('Waiting: 1');
    expect(await buildDigest(h.deps, providerId, '2026-11-05')).toBe('skipped');

    h.clock.current = new Date('2026-11-06T18:30:00.000Z'); // next day, a missed tick still sends
    await runSweep(h.deps);
    await h.drain();
    expect(h.telegram.sent).toHaveLength(2);
  });

  it('recovers a notification whose enqueue was lost', async () => {
    const { token, providerId } = await h.login();
    await h.db.provider.update({ where: { id: providerId }, data: { telegramChatId: 777n } });
    const { reference } = await sentJob(token);
    h.kora.pay(reference, 2_500_000n);
    const { verifyReference } = await import('../../src/services/payments');
    await verifyReference(h.deps, reference, null);
    h.queue.length = 0; // simulate the lost enqueue
    // createdAt comes from the database clock; age it relative to the test clock.
    await h.db.notification.updateMany({ data: { createdAt: new Date(h.clock.now().getTime() - 3 * MIN) } });
    expect((await runSweep(h.deps)).outboxRetries).toBe(1);
    await h.drain();
    expect(h.telegram.sent).toHaveLength(1);
    expect((await runSweep(h.deps)).outboxRetries).toBe(0);
  });

  it('a provider without Telegram gets the notification marked failed, not retried forever', async () => {
    const { token } = await h.login();
    const { reference } = await sentJob(token);
    h.kora.pay(reference, 2_500_000n);
    const { verifyReference } = await import('../../src/services/payments');
    await verifyReference(h.deps, reference, null);
    await h.drain();
    const n = await h.db.notification.findFirstOrThrow();
    expect(n.sentAt).toBeNull();
    expect(n.failedAt).not.toBeNull();
  });

  it('re-verifies webhooks that were stored but never processed', async () => {
    const { token } = await h.login();
    const { reference } = await sentJob(token);
    await h.db.webhookEvent.create({
      data: { eventKey: 'k1', eventType: 'charge.success', reference, signatureOk: true, payload: {}, receivedAt: new Date(h.clock.now().getTime() - 6 * MIN) },
    });
    h.kora.pay(reference, 2_500_000n);
    expect((await runSweep(h.deps)).webhookRetries).toBe(1);
    await h.drain();
    expect(await h.db.payment.count()).toBe(1);
    expect((await h.db.webhookEvent.findFirstOrThrow()).processedAt).not.toBeNull();
  });
});
