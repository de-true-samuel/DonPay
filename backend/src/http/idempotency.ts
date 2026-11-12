/**
 * Idempotency-Key support (BE-09) for the calls a double tap or a flaky network must not repeat:
 * create job, request balance, get payment details (send/resend), record manual payment.
 *
 * - Keys are scoped per provider and kept for 24 hours.
 * - Same key + same method, path and body → the original status and body, replayed
 *   (header `Idempotent-Replayed: true`).
 * - Same key + different body → 422 IDEMPOTENCY_KEY_REUSED.
 * - Same key while the first call is still running → 409 IDEMPOTENCY_IN_PROGRESS (retry shortly).
 * - 5xx results (e.g. KORA_UNAVAILABLE) are NOT stored, so a retry with the same key runs again.
 */
import type { MiddlewareHandler } from 'hono';
import { AppError, validation } from '../errors';
import { sha256Hex } from '../integrations/kora/signature';
import type { AppEnv } from './app';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** A row still "in progress" after this long belongs to a crashed call and may be taken over. */
const ABANDONED_MS = 2 * 60 * 1000;
const KEY_RE = /^[\x21-\x7e]{1,200}$/;

export const idempotent: MiddlewareHandler<AppEnv> = async (c, next) => {
  const key = c.req.header('idempotency-key');
  if (key === undefined) return next();
  if (!KEY_RE.test(key)) throw validation('Idempotency-Key must be 1 to 200 visible ASCII characters', 'Idempotency-Key');

  const deps = c.get('deps');
  const providerId = c.get('provider').id;
  const method = c.req.method;
  const path = c.req.path;
  const bodyHash = await sha256Hex(`${method} ${path}\n${await c.req.text()}`);
  const db = deps.db;
  const now = deps.now();

  const claim = async () =>
    (
      await db.idempotencyKey.createMany({
        data: [{ providerId, key, method, path, bodyHash, createdAt: now, expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS) }],
        skipDuplicates: true,
      })
    ).count === 1;

  let mine = await claim();
  if (!mine) {
    const existing = await db.idempotencyKey.findUnique({ where: { providerId_key: { providerId, key } } });
    const stale =
      !existing || existing.expiresAt <= now || (existing.status === null && now.getTime() - existing.createdAt.getTime() > ABANDONED_MS);
    if (stale) {
      if (existing) await db.idempotencyKey.deleteMany({ where: { id: existing.id, status: existing.status } });
      mine = await claim();
      if (!mine) throw new AppError('IDEMPOTENCY_IN_PROGRESS', 'This request is already being processed. Try again in a moment.');
    } else if (existing.bodyHash !== bodyHash) {
      throw new AppError('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request.');
    } else if (existing.status === null) {
      throw new AppError('IDEMPOTENCY_IN_PROGRESS', 'This request is already being processed. Try again in a moment.');
    } else {
      deps.log.info('idempotency.replayed', { providerId, path });
      c.header('Idempotent-Replayed', 'true');
      // Stored as the exact response text (jsonb would reorder keys), so the replay is byte-identical.
      const stored = existing.responseBody;
      return c.body(typeof stored === 'string' ? stored : JSON.stringify(stored), existing.status as 200, { 'Content-Type': 'application/json; charset=UTF-8' });
    }
  }

  await next();

  // Hono has already turned a thrown error into c.res via onError.
  const res = c.res;
  try {
    if (res.status >= 500) {
      await db.idempotencyKey.deleteMany({ where: { providerId, key } });
      return;
    }
    const body = await res.clone().text();
    await db.idempotencyKey.updateMany({ where: { providerId, key }, data: { status: res.status, responseBody: body } });
  } catch (err) {
    // Never fail the real response because the key couldn't be saved; drop it so retries run.
    deps.log.warn('idempotency.store_failed', { providerId, path, error: (err as Error).message });
    await db.idempotencyKey.deleteMany({ where: { providerId, key } }).catch(() => undefined);
  }
};
