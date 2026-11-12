/**
 * Queue consumer. One queue, typed messages (src/queue/messages.ts). Failures are retried with
 * backoff; after max_retries Cloudflare moves the message to the dead-letter queue, whose
 * consumer turns it into something a human can see.
 */
import type { Deps } from '../deps';
import { KoraError } from '../integrations/kora/types';
import { buildDigest, checkExpiry } from '../services/background';
import { sendNotification } from '../services/notifications';
import { verifyReference } from '../services/payments';
import { reconcileRequest } from '../services/reconcile';
import { queueMessageSchema, type QueueMessage } from './messages';

export interface QueueMessageLike {
  id: string;
  body: unknown;
  attempts: number;
  ack(): void;
  retry(opts?: { delaySeconds?: number }): void;
}

export async function handleMessage(deps: Deps, msg: QueueMessage): Promise<void> {
  switch (msg.type) {
    case 'kora.verify':
      await verifyReference(deps, msg.reference, msg.webhookEventId);
      return;
    case 'request.checkExpiry':
      await checkExpiry(deps, msg.requestId);
      return;
    case 'request.recheck':
      await reconcileRequest(deps, msg.requestId);
      return;
    case 'notify.send':
      await sendNotification(deps, msg.notificationId);
      return;
    case 'digest.build':
      await buildDigest(deps, msg.providerId, msg.date);
      return;
  }
}

/** Exponential backoff: 10s, 20s, 40s, 80s … capped at 10 minutes. */
export const retryDelaySeconds = (attempts: number) => Math.min(600, 10 * 2 ** Math.max(0, attempts - 1));

export async function processBatch(deps: Deps, messages: readonly QueueMessageLike[]): Promise<void> {
  for (const m of messages) {
    const parsed = queueMessageSchema.safeParse(m.body);
    if (!parsed.success) {
      deps.log.error('queue.invalid_message', { messageId: m.id, issues: parsed.error.issues.slice(0, 3) });
      m.ack();
      continue;
    }
    try {
      await handleMessage(deps, parsed.data);
      m.ack();
    } catch (err) {
      const nonRetryable = err instanceof KoraError && !err.retryable;
      deps.log.error('queue.handler_failed', {
        type: parsed.data.type,
        messageId: m.id,
        attempts: m.attempts,
        retrying: !nonRetryable,
        error: (err as Error).message,
        ...('reference' in parsed.data ? { koraReference: parsed.data.reference } : {}),
      });
      if (nonRetryable) {
        await deadLetter(deps, parsed.data, (err as Error).message);
        m.ack();
      } else {
        m.retry({ delaySeconds: retryDelaySeconds(m.attempts) });
      }
    }
  }
}

/** Messages that exhausted their retries. Make each failure visible, then ack. */
export async function processDeadLetterBatch(deps: Deps, messages: readonly QueueMessageLike[]): Promise<void> {
  for (const m of messages) {
    const parsed = queueMessageSchema.safeParse(m.body);
    try {
      if (parsed.success) await deadLetter(deps, parsed.data, 'Exhausted retries');
    } catch (err) {
      deps.log.error('queue.dlq_handler_failed', { messageId: m.id, error: (err as Error).message });
    }
    m.ack();
  }
}

async function deadLetter(deps: Deps, msg: QueueMessage, reason: string): Promise<void> {
  deps.log.error('queue.dead_letter', { ...msg, reason });
  if (msg.type === 'kora.verify') {
    const req = await deps.db.paymentRequest.findUnique({ where: { koraReference: msg.reference }, select: { id: true, providerId: true, jobId: true } });
    await deps.db.reviewItem.create({
      data: {
        kind: 'VERIFICATION_FAILED',
        providerId: req?.providerId ?? null,
        jobId: req?.jobId ?? null,
        requestId: req?.id ?? null,
        webhookEventId: msg.webhookEventId,
        detail: { reference: msg.reference, reason },
      },
    });
    if (msg.webhookEventId) {
      await deps.db.webhookEvent.update({ where: { id: msg.webhookEventId }, data: { processedAt: deps.now(), error: `Dead-lettered: ${reason}` } });
    }
  } else if (msg.type === 'notify.send') {
    await deps.db.notification.updateMany({ where: { id: msg.notificationId, sentAt: null }, data: { failedAt: deps.now(), lastError: reason } });
  }
}
