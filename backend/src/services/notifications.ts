/**
 * Transactional outbox. A notification row is written in the SAME transaction as the state change
 * it describes; sending happens afterwards via the queue. The unique dedupeKey means a retried
 * transaction or replayed event can never create a second alert.
 */
import type { Tx } from '../db/client';
import type { Deps } from '../deps';
import type { NotificationKind } from '../generated/prisma/enums';
import type { InlineButton } from '../integrations/telegram/sender';
import { TelegramSendError } from '../integrations/telegram/sender';

export interface NotificationPayload {
  text: string;
  buttons?: InlineButton[][];
}

export async function createNotification(
  tx: Tx,
  n: { providerId: string; kind: NotificationKind; dedupeKey: string; payload: NotificationPayload },
): Promise<{ id: string; created: boolean }> {
  // ON CONFLICT DO NOTHING: a unique violation would abort the surrounding transaction.
  const { count } = await tx.notification.createMany({
    data: [{ providerId: n.providerId, kind: n.kind, dedupeKey: n.dedupeKey, payload: n.payload as object }],
    skipDuplicates: true,
  });
  const row = await tx.notification.findUniqueOrThrow({ where: { dedupeKey: n.dedupeKey }, select: { id: true } });
  return { id: row.id, created: count > 0 };
}

export async function enqueueNotifications(deps: Deps, ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await deps.queue.send({ type: 'notify.send', notificationId: id });
    } catch (err) {
      // Not fatal: the cron outbox sweep picks up unsent rows after 2 minutes.
      deps.log.warn('notify.enqueue_failed', { notificationId: id, error: (err as Error).message });
    }
  }
}

export type SendOutcome = 'sent' | 'already_sent' | 'no_chat' | 'failed_permanently';

/** Send one notification. Throws on retryable failures so the queue retries it. */
export async function sendNotification(deps: Deps, notificationId: string): Promise<SendOutcome> {
  const n = await deps.db.notification.findUnique({
    where: { id: notificationId },
    include: { provider: { select: { telegramChatId: true } } },
  });
  if (!n) return 'failed_permanently';
  if (n.sentAt) return 'already_sent';
  if (n.failedAt) return 'failed_permanently';
  if (n.provider.telegramChatId == null) {
    await deps.db.notification.update({
      where: { id: n.id },
      data: { failedAt: deps.now(), lastError: 'Provider has not connected Telegram' },
    });
    return 'no_chat';
  }
  const payload = n.payload as unknown as NotificationPayload;
  try {
    await deps.telegram.sendMessage(n.provider.telegramChatId, payload.text, payload.buttons);
  } catch (err) {
    const retryable = !(err instanceof TelegramSendError) || err.retryable;
    await deps.db.notification.update({
      where: { id: n.id },
      data: {
        attempts: { increment: 1 },
        lastError: (err as Error).message.slice(0, 500),
        ...(retryable ? {} : { failedAt: deps.now() }),
      },
    });
    if (retryable) throw err;
    deps.log.warn('notify.failed_permanently', { notificationId: n.id, error: (err as Error).message });
    return 'failed_permanently';
  }
  await deps.db.notification.update({ where: { id: n.id }, data: { sentAt: deps.now(), attempts: { increment: 1 } } });
  deps.log.info('notify.sent', { notificationId: n.id, kind: n.kind, providerId: n.providerId });
  return 'sent';
}
