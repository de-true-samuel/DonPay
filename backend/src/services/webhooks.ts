/**
 * Kora webhook intake (ARCHITECTURE.md §6.2 steps 1–4): verify signature, store the raw event
 * with a unique key (duplicates are no-ops), enqueue verification, return fast. No Kora calls here.
 */
import type { Deps } from '../deps';
import { sha256Hex, verifyKoraSignature } from '../integrations/kora/signature';

export type WebhookResult = { status: 200 | 400 | 401 | 503; body: { ok: boolean; duplicate?: boolean; error?: string } };

export async function receiveKoraWebhook(deps: Deps, rawBody: string, signature: string | null): Promise<WebhookResult> {
  let payload: { event?: unknown; data?: { reference?: unknown; status?: unknown } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { ok: false, error: 'Invalid JSON' } };
  }
  const secret = deps.config.koraSecretKey;
  if (!secret) {
    deps.log.error('kora.webhook_no_secret', {});
    return { status: 503, body: { ok: false, error: 'Webhook verification is not configured' } };
  }
  const event = typeof payload.event === 'string' ? payload.event : 'unknown';
  const reference = typeof payload.data?.reference === 'string' ? payload.data.reference : null;
  const status = typeof payload.data?.status === 'string' ? payload.data.status : '';
  const signatureOk = await verifyKoraSignature(secret, payload, signature);

  if (!signatureOk) {
    // Keep a record for auditing, under a key that can never collide with a genuine event.
    await deps.db.webhookEvent.createMany({
      data: [{ eventKey: `badsig:${await sha256Hex(rawBody)}`, eventType: event, reference, signatureOk: false, payload: payload as object }],
      skipDuplicates: true,
    });
    deps.log.warn('kora.webhook_bad_signature', { koraReference: reference, event });
    return { status: 401, body: { ok: false, error: 'Invalid signature' } };
  }

  const eventKey = await sha256Hex(`${event}:${reference ?? ''}:${status}`);
  const { count } = await deps.db.webhookEvent.createMany({
    data: [{ eventKey, eventType: event, reference, signatureOk: true, payload: payload as object }],
    skipDuplicates: true,
  });
  if (count === 0) {
    deps.log.info('kora.webhook_duplicate', { koraReference: reference, event });
    return { status: 200, body: { ok: true, duplicate: true } };
  }
  const stored = await deps.db.webhookEvent.findUniqueOrThrow({ where: { eventKey }, select: { id: true } });
  if (!reference) {
    await deps.db.webhookEvent.update({ where: { id: stored.id }, data: { processedAt: deps.now(), error: 'No reference in payload' } });
    return { status: 200, body: { ok: true } };
  }
  try {
    await deps.queue.send({ type: 'kora.verify', reference, webhookEventId: stored.id });
  } catch (err) {
    // The cron sweep re-enqueues unprocessed events after 5 minutes, so still acknowledge Kora.
    deps.log.error('kora.webhook_enqueue_failed', { koraReference: reference, error: (err as Error).message });
  }
  deps.log.info('kora.webhook_received', { koraReference: reference, event, webhookEventId: stored.id });
  return { status: 200, body: { ok: true } };
}
